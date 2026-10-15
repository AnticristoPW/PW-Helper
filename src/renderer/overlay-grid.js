'use strict';
// Transparent, click-through overlay drawn over a PW window: alignment grid, or click markers (?mode=clicks&points=x,y;x,y).
const q = new URLSearchParams(location.search);
const c = document.getElementById('c');
const draw = () => {
  c.width = innerWidth; c.height = innerHeight;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (q.get('mode') === 'clicks') {
    const pts = (q.get('points') || '').split(';').filter(Boolean).map((p) => p.split(',').map(Number));
    pts.forEach(([x, y], i) => {
      g.strokeStyle = '#0dcaf0'; g.fillStyle = 'rgba(13,202,240,.25)'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.fillText(String(i + 1), x, y + 5);
    });
    return;
  }
  const step = 50;
  g.lineWidth = 1;
  for (let x = 0; x <= c.width; x += step) { g.strokeStyle = x % (step * 4) === 0 ? 'rgba(255,60,60,.8)' : 'rgba(255,60,60,.35)'; g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, c.height); g.stroke(); }
  for (let y = 0; y <= c.height; y += step) { g.strokeStyle = y % (step * 4) === 0 ? 'rgba(255,60,60,.8)' : 'rgba(255,60,60,.35)'; g.beginPath(); g.moveTo(0, y + .5); g.lineTo(c.width, y + .5); g.stroke(); }
  g.strokeStyle = 'rgba(60,255,60,.9)'; g.beginPath(); g.moveTo(c.width / 2 + .5, 0); g.lineTo(c.width / 2 + .5, c.height); g.moveTo(0, c.height / 2 + .5); g.lineTo(c.width, c.height / 2 + .5); g.stroke();
};
addEventListener('resize', draw);
draw();
