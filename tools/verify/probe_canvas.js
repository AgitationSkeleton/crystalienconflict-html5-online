// For tools/verify/profile.py --probe3: on a slow frame, which canvas calls take the time (and on
// what size of canvas, from what source).
(n) => {
  const P = CanvasRenderingContext2D.prototype;
  const names = ['drawImage', 'fill', 'fillRect', 'clearRect', 'getImageData', 'putImageData', 'fillText', 'stroke', 'clip', 'restore', 'save', 'setTransform'];
  const orig = {};
  let rec = null;
  for (const k of names) {
    orig[k] = P[k];
    P[k] = function (...a) {
      if (!rec) return orig[k].apply(this, a);
      const t = performance.now();
      const out = orig[k].apply(this, a);
      const dt = performance.now() - t;
      if (dt > 5) {
        const src = k === 'drawImage' && a[0] ? (a[0].width + 'x' + a[0].height + ' ' + (a[0].tagName || a[0].constructor.name)) : '';
        rec.push([k, +dt.toFixed(1), this.canvas.width + 'x' + this.canvas.height, src, (new Error().stack || '').split('\n').slice(2, 6).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < ')]);
      }
      return out;
    };
  }
  const slow = [];
  for (let i = 0; i < n; i++) {
    player.tick();
    rec = [];
    const t = performance.now(); player.draw(); const d = performance.now() - t;
    if (d > 50 && slow.length < 3) slow.push({ frame: i, draw: +d.toFixed(1), calls: rec.slice(0, 10) });
    rec = null;
  }
  for (const k of names) P[k] = orig[k];
  return slow;
}
