// For tools/verify/profile.py --probe: where the drawing's slow frames go.  Wraps the renderer's
// filtered drawing and team colouring, and the game's shroud, to time them; returns the
// totals over the frames it is run for.
(n) => {
  const r = player.renderer;
  const stats = { filt: 0, filtMiss: 0, filtMs: 0, filtMissMs: 0, teamed: 0, teamedMs: 0, missBy: {}, slow: [] };
  const origF = r.drawFiltered.bind(r);
  r.drawFiltered = function (ctx, obj, m, cx, filters) {
    const before = r.fcacheIds;
    const t = performance.now();
    origF(ctx, obj, m, cx, filters);
    const dt = performance.now() - t;
    stats.filt++; stats.filtMs += dt;
    if (r.fcacheIds !== before) {
      stats.filtMiss++; stats.filtMissMs += dt;
      const name = (obj.$name || '?') + '/' + (obj.$parent && obj.$parent.$name || '?') + ' ' + filters.map((f) => f.type).join('+');
      const e = stats.missBy[name] || (stats.missBy[name] = { n: 0, ms: 0 });
      e.n++; e.ms += dt;
    }
  };
  const origT = r.teamed.bind(r);
  r.teamed = function (key, img, id, lib, team) {
    const had = r.tints.has(key + '|team:' + team);
    const t = performance.now();
    const out = origT(key, img, id, lib, team);
    if (!had) { stats.teamed++; stats.teamedMs += performance.now() - t; }
    return out;
  };
  stats.tinted = 0; stats.tintedMs = 0;
  const origTi = r.tinted.bind(r);
  r.tinted = function (key, img, cx) {
    const had = r.tints.size;
    const t = performance.now();
    const out = origTi(key, img, cx);
    if (r.tints.size !== had || !r.tints.has(key)) { stats.tinted++; stats.tintedMs += performance.now() - t; }
    return out;
  };
  const ticks = [], draws = [];
  for (let i = 0; i < n; i++) {
    let t = performance.now(); player.tick(); ticks.push(performance.now() - t);
    const f0 = stats.filtMissMs, t0 = stats.teamedMs, ti0 = stats.tintedMs;
    t = performance.now(); player.draw(); const d = performance.now() - t; draws.push(d);
    if (d > 50) stats.slow.push({ frame: i, draw: +d.toFixed(1), filtMiss: +(stats.filtMissMs - f0).toFixed(1), teamed: +(stats.teamedMs - t0).toFixed(1), tinted: +(stats.tintedMs - ti0).toFixed(1) });
  }
  r.drawFiltered = origF; r.teamed = origT; r.tinted = origTi;
  const top = Object.entries(stats.missBy).sort((a, b) => b[1].ms - a[1].ms).slice(0, 15).map(([k, v]) => [k, v.n, +v.ms.toFixed(1)]);
  return { filt: stats.filt, filtMiss: stats.filtMiss, filtMs: +stats.filtMs.toFixed(1), filtMissMs: +stats.filtMissMs.toFixed(1),
    teamed: stats.teamed, teamedMs: +stats.teamedMs.toFixed(1), tinted: stats.tinted, tintedMs: +stats.tintedMs.toFixed(1), slow: stats.slow.slice(0, 20), top,
    drawTotal: +draws.reduce((a, b) => a + b, 0).toFixed(1), tickTotal: +ticks.reduce((a, b) => a + b, 0).toFixed(1) };
}
