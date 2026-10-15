# Persistent window/input worker. Reads one JSON command per line on stdin and answers one JSON line on stdout.
# ops: mem {pid,module,ptr,specs} | memforget {pid} | focus {pid} | key {pid,vk,background} | click {pid,x,y,background} | info {pid}
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class W {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr e);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SetWindowText(IntPtr h, string s);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr inst, string name, uint type, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  static Dictionary<uint, IntPtr> hidden = new Dictionary<uint, IntPtr>();

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

  public static IntPtr MainWindow(uint pid) {
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

  static IntPtr Find(uint pid) {
    IntPtr h;
    if (hidden.TryGetValue(pid, out h)) { if (IsWindow(h)) return h; hidden.Remove(pid); }
    return MainWindow(pid);
  }
  public static bool Hide(uint pid) {
    IntPtr h = MainWindow(pid);
    if (h == IntPtr.Zero) return false;
    hidden[pid] = h; ShowWindow(h, 0); return true;
  }
  public static bool Show(uint pid) {
    IntPtr h; if (!hidden.TryGetValue(pid, out h)) h = MainWindow(pid);
    if (h == IntPtr.Zero) return false;
    hidden.Remove(pid); ShowWindow(h, 5); return true;
  }
  // x/y/w/h < 0 keeps the current value.
  public static bool SetPos(uint pid, int x, int y, int w, int hgt) {
    IntPtr h = Find(pid); if (h == IntPtr.Zero) return false;
    RECT r; GetWindowRect(h, out r);
    if (x == int.MinValue) x = r.L; if (y == int.MinValue) y = r.T;
    if (w <= 0) w = r.R - r.L; if (hgt <= 0) hgt = r.B - r.T;
    return SetWindowPos(h, IntPtr.Zero, x, y, w, hgt, 0x14);
  }
  public static bool SetTitle(uint pid, string text) { IntPtr h = Find(pid); return h != IntPtr.Zero && SetWindowText(h, text); }
  public static bool SetIcon(uint pid, string path) {
    IntPtr h = Find(pid); if (h == IntPtr.Zero) return false;
    IntPtr small = LoadImage(IntPtr.Zero, path, 1, 16, 16, 0x10), big = LoadImage(IntPtr.Zero, path, 1, 32, 32, 0x10);
    if (small == IntPtr.Zero && big == IntPtr.Zero) return false;
    if (small != IntPtr.Zero) SendMessage(h, 0x80, IntPtr.Zero, small);
    if (big != IntPtr.Zero) SendMessage(h, 0x80, (IntPtr)1, big);
    return true;
  }

  public static bool Focus(uint pid) {
    IntPtr h = MainWindow(pid);
    if (h == IntPtr.Zero) return false;
    if (IsIconic(h)) ShowWindow(h, 9);
    IntPtr fg = GetForegroundWindow();
    uint tmp; uint fgThread = GetWindowThreadProcessId(fg, out tmp);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fgThread, true);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // unlocks SetForegroundWindow
    bool ok = SetForegroundWindow(h);
    AttachThreadInput(me, fgThread, false);
    return ok;
  }

  public static void Key(uint pid, byte vk, bool background) {
    byte scan = (byte)MapVirtualKey(vk, 0);
    if (background) {
      IntPtr h = MainWindow(pid);
      if (h == IntPtr.Zero) throw new Exception("janela não encontrada");
      long down = 1 | ((long)scan << 16), up = down | (1L << 30) | (1L << 31);
      PostMessage(h, 0x100, (IntPtr)vk, (IntPtr)down);
      PostMessage(h, 0x101, (IntPtr)vk, (IntPtr)up);
    } else {
      keybd_event(vk, scan, 0, UIntPtr.Zero);
      keybd_event(vk, scan, 2, UIntPtr.Zero);
    }
  }

  public static void Click(uint pid, int x, int y, bool background, bool right = false) {
    IntPtr h = MainWindow(pid);
    if (h == IntPtr.Zero) throw new Exception("janela não encontrada");
    if (background) {
      IntPtr lp = (IntPtr)((y << 16) | (x & 0xFFFF));
      if (right) { PostMessage(h, 0x204, (IntPtr)2, lp); PostMessage(h, 0x205, IntPtr.Zero, lp); }
      else { PostMessage(h, 0x201, (IntPtr)1, lp); PostMessage(h, 0x202, IntPtr.Zero, lp); }
    } else {
      POINT pt; pt.X = x; pt.Y = y; ClientToScreen(h, ref pt);
      SetCursorPos(pt.X, pt.Y);
      mouse_event(right ? 8u : 2u, 0, 0, 0, UIntPtr.Zero);
      mouse_event(right ? 16u : 4u, 0, 0, 0, UIntPtr.Zero);
    }
  }

  public static uint Foreground() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }

  public static string Info(uint pid) {
    IntPtr h = Find(pid);
    if (h == IntPtr.Zero) return null;
    RECT r; GetWindowRect(h, out r);
    StringBuilder sb = new StringBuilder(256); GetWindowText(h, sb, 256);
    return sb.ToString() + "\t" + r.L + "\t" + r.T + "\t" + (r.R - r.L) + "\t" + (r.B - r.T) + "\t" + (IsIconic(h) ? 1 : 0);
  }
}

public static class M {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
  static Dictionary<uint, IntPtr> handles = new Dictionary<uint, IntPtr>();
  static Dictionary<string, long> bases = new Dictionary<string, long>();

  static IntPtr Handle(uint pid) {
    IntPtr h;
    if (handles.TryGetValue(pid, out h)) return h;
    h = OpenProcess(0x0410, false, pid); // QUERY_INFORMATION | VM_READ
    if (h == IntPtr.Zero) throw new Exception("não foi possível abrir o processo " + pid);
    handles[pid] = h; return h;
  }
  public static void Forget(uint pid) {
    IntPtr h; if (handles.TryGetValue(pid, out h)) { CloseHandle(h); handles.Remove(pid); }
    List<string> dead = new List<string>();
    foreach (string k in bases.Keys) if (k.StartsWith(pid + "|")) dead.Add(k);
    foreach (string k in dead) bases.Remove(k);
  }
  public static long ModuleBase(uint pid, string name) {
    string key = pid + "|" + name.ToLowerInvariant();
    long b; if (bases.TryGetValue(key, out b)) return b;
    System.Diagnostics.Process p = System.Diagnostics.Process.GetProcessById((int)pid);
    foreach (System.Diagnostics.ProcessModule m in p.Modules)
      if (string.Equals(m.ModuleName, name, StringComparison.OrdinalIgnoreCase)) { b = (long)m.BaseAddress; bases[key] = b; return b; }
    throw new Exception("módulo " + name + " não encontrado");
  }
  public static byte[] Read(IntPtr h, long addr, int len) {
    byte[] buf = new byte[len]; IntPtr got;
    if (addr < 0x10000 || !ReadProcessMemory(h, (IntPtr)addr, buf, (IntPtr)len, out got) || (int)got != len)
      throw new Exception("leitura falhou em 0x" + addr.ToString("X"));
    return buf;
  }
  public static long ReadPtr(IntPtr h, long addr, int ptr) {
    byte[] b = Read(h, addr, ptr);
    return ptr == 8 ? BitConverter.ToInt64(b, 0) : (long)BitConverter.ToUInt32(b, 0);
  }
  // Pointer path: every chain step AND the final offset is "dereference, then add"; the value is an int32 there.
  public static long ReadChain(uint pid, long start, long[] chain, long offset, int ptr) {
    IntPtr h = Handle(pid);
    long a = start;
    foreach (long c in chain) a = ReadPtr(h, a, ptr) + c;
    a = ReadPtr(h, a, ptr) + offset;
    return BitConverter.ToInt32(Read(h, a, 4), 0);
  }
  // Static table: int32 at start + index * elementSize (no dereference).
  public static long ReadArray(uint pid, long start, long index, int elem) {
    return BitConverter.ToInt32(Read(Handle(pid), start + index * elem, 4), 0);
  }
}
'@

function Hex($v) { if ($null -eq $v) { return [long]0 } return [Convert]::ToInt64(([string]$v).Substring(2), 16) }

# mem {pid, module, ptr, specs:[{name,module,base,chain,offset,type,ptr_size,index_by,element_size}]} -> {values, errors}
function ReadMem($cmd) {
  $pid_ = [uint32]$cmd.pid
  $values = @{}; $errors = @{}
  $ordered = @($cmd.specs | Where-Object { $_.type -ne 'int_array' }) + @($cmd.specs | Where-Object { $_.type -eq 'int_array' })
  foreach ($s in $ordered) {
    try {
      $mod = if ($s.module) { [string]$s.module } else { [string]$cmd.module }
      $ptr = if ($s.ptr_size) { [int]$s.ptr_size } else { [int]$cmd.ptr }
      $start = [M]::ModuleBase($pid_, $mod) + (Hex $s.base)
      if ($s.type -eq 'int_array') {
        $idx = $values[[string]$s.index_by]
        if ($null -eq $idx) { throw "índice '$($s.index_by)' indisponível" }
        $es = if ($s.element_size) { [int]$s.element_size } else { 4 }
        $values[$s.name] = [M]::ReadArray($pid_, $start + (Hex $s.offset), [long]$idx, $es)
      } else {
        $chain = [long[]]@($s.chain | ForEach-Object { Hex $_ })
        $values[$s.name] = [M]::ReadChain($pid_, $start, $chain, (Hex $s.offset), $ptr)
      }
    } catch { $errors[$s.name] = $_.Exception.Message }
  }
  return @{ values = $values; errors = $errors }
}

$in = [Console]::In
while ($true) {
  $line = $in.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  $id = $null
  try {
    $cmd = $line | ConvertFrom-Json
    $id = $cmd.id
    $data = $null
    switch ($cmd.op) {
      'focus' { $data = [W]::Focus([uint32]$cmd.pid) }
      'key'   { [W]::Key([uint32]$cmd.pid, [byte]$cmd.vk, [bool]$cmd.background); $data = $true }
      'click' { [W]::Click([uint32]$cmd.pid, [int]$cmd.x, [int]$cmd.y, [bool]$cmd.background, [bool]$cmd.right); $data = $true }
      'hide'  { $data = [W]::Hide([uint32]$cmd.pid) }
      'show'  { $data = [W]::Show([uint32]$cmd.pid) }
      'setpos' { $data = [W]::SetPos([uint32]$cmd.pid, $(if ($null -ne $cmd.x) { [int]$cmd.x } else { [int]::MinValue }), $(if ($null -ne $cmd.y) { [int]$cmd.y } else { [int]::MinValue }), [int]$cmd.w, [int]$cmd.h) }
      'title' { $data = [W]::SetTitle([uint32]$cmd.pid, [string]$cmd.text) }
      'icon'  { $data = [W]::SetIcon([uint32]$cmd.pid, [string]$cmd.path) }
      'fg'    { $data = [W]::Foreground() }
      'info'  { $data = [W]::Info([uint32]$cmd.pid) }
      'mem'   { $data = ReadMem $cmd }
      'memforget' { [M]::Forget([uint32]$cmd.pid); $data = $true }
      default { throw "op desconhecida: $($cmd.op)" }
    }
    [Console]::Out.WriteLine((@{ id = $id; ok = $true; data = $data } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ id = $id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
