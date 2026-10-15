# Global input hooks. Emits one JSON line per event on stdout; reads control commands (one per line) on stdin.
#   {"keys":true|false}                      -> report key down/up events ({"t":"key","state","vk","shift","ctrl","alt"})
#   {"mouse":"off"|"on"|"block"}             -> report mouse clicks over any window ({"t":"click","button","pid","x","y","sx","sy"}); "block" swallows the click
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Collections.Generic;

public static class H {
  delegate IntPtr Proc(int code, IntPtr w, IntPtr l);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc p, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hk, int code, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct KBD { public uint vk, scan, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MSL { public POINT pt; public uint data, flags, time; public IntPtr extra; }

  public static volatile bool Keys = false;
  public static volatile int Mouse = 0; // 0 off, 1 on, 2 block
  static Proc kp, mp;
  static HashSet<int> down = new HashSet<int>();
  static object gate = new object();
  static int ownPid = Process.GetCurrentProcess().Id;

  static void Emit(string s) { lock (gate) { Console.Out.WriteLine(s); Console.Out.Flush(); } }

  static IntPtr MainWindow(uint pid) {
    IntPtr best = IntPtr.Zero; long bestArea = -1;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero || GetWindowTextLength(h) == 0) return true;
      RECT r; GetWindowRect(h, out r);
      long a = (long)(r.R - r.L) * (r.B - r.T);
      if (a > bestArea) { bestArea = a; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  static IntPtr KeyProc(int code, IntPtr w, IntPtr l) {
    if (code >= 0 && Keys) {
      KBD k = (KBD)Marshal.PtrToStructure(l, typeof(KBD));
      int m = (int)w;
      bool isDown = m == 0x100 || m == 0x104;
      int vk = (int)k.vk;
      bool fire = true;
      if (isDown) { if (down.Contains(vk)) fire = false; else down.Add(vk); } else down.Remove(vk);
      if (fire) {
        bool sh = (GetAsyncKeyState(0x10) & 0x8000) != 0, ct = (GetAsyncKeyState(0x11) & 0x8000) != 0, al = (GetAsyncKeyState(0x12) & 0x8000) != 0;
        Emit("{\"t\":\"key\",\"state\":\"" + (isDown ? "down" : "up") + "\",\"vk\":" + vk + ",\"shift\":" + (sh ? "true" : "false") + ",\"ctrl\":" + (ct ? "true" : "false") + ",\"alt\":" + (al ? "true" : "false") + "}");
      }
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  static IntPtr MouseProc(int code, IntPtr w, IntPtr l) {
    int m = (int)w;
    if (code >= 0 && Mouse > 0 && (m == 0x201 || m == 0x202 || m == 0x204 || m == 0x205)) {
      MSL s = (MSL)Marshal.PtrToStructure(l, typeof(MSL));
      IntPtr h = WindowFromPoint(s.pt);
      uint pid = 0; if (h != IntPtr.Zero) GetWindowThreadProcessId(h, out pid);
      if (pid != 0 && pid != ownPid) {
        bool press = m == 0x201 || m == 0x204;
        if (press) {
          IntPtr main = MainWindow(pid);
          POINT c = s.pt;
          if (main != IntPtr.Zero) ScreenToClient(main, ref c);
          Emit("{\"t\":\"click\",\"button\":\"" + (m == 0x201 ? "left" : "right") + "\",\"pid\":" + pid + ",\"x\":" + c.X + ",\"y\":" + c.Y + ",\"sx\":" + s.pt.X + ",\"sy\":" + s.pt.Y + "}");
        }
        if (Mouse == 2) return (IntPtr)1;
      }
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  public static void Run() {
    kp = KeyProc; mp = MouseProc;
    IntPtr mod = GetModuleHandle(null);
    SetWindowsHookEx(13, kp, mod, 0);
    SetWindowsHookEx(14, mp, mod, 0);
    System.Windows.Forms.Application.Run();
  }
}
'@

# stdin control runs on a background runspace so the main thread can pump hook messages
$ps = [PowerShell]::Create()
[void]$ps.AddScript({
  while (($line = [Console]::In.ReadLine()) -ne $null) {
    try {
      $c = $line | ConvertFrom-Json
      if ($null -ne $c.keys) { [H]::Keys = [bool]$c.keys }
      if ($null -ne $c.mouse) { [H]::Mouse = @{ off = 0; on = 1; block = 2 }[[string]$c.mouse] }
    } catch {}
  }
  [Environment]::Exit(0)
})
[void]$ps.BeginInvoke()
[H]::Run()
