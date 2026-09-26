// For tools/verify/profile.py --probe2: which top-level parts of the game take a slow frame's
// drawing time.  Times the drawing of every clip down to a few levels, and on frames that
// take over 50 ms reports the slowest ones by path.
(n) => {
  const r = player.renderer;
  const orig = r.draw.bind(r);
  let times = null;
  const pathOf = (o) => { const p = []; for (let x = o; x && p.length < 3; x = x.$parent) p.unshift(x.$name || ('#' + (x.$charId || '?'))); return p.join('/'); };
  const depthOf = (o) => { let d = 0; for (let x = o; x && x.$parent; x = x.$parent) d++; return d; };
  r.draw = function (ctx, obj, m, cx) {
    if (!times || depthOf(obj) > 9) return orig(ctx, obj, m, cx);
    const t = performance.now();
    const out = orig(ctx, obj, m, cx);
    const k = pathOf(obj);
    times[k] = (times[k] || 0) + performance.now() - t;
    return out;
  };
  const slow = [];
  for (let i = 0; i < n; i++) {
    player.tick();
    times = {};
    const t = performance.now(); player.draw(); const d = performance.now() - t;
    if (d > 50 && slow.length < 4) slow.push({ frame: i, draw: +d.toFixed(1), top: Object.entries(times).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, +v.toFixed(1)]) });
    times = null;
  }
  r.draw = orig;
  return slow;
}
