// For tools/verify/fps.py --probe: which images the drawing spends its time drawing -- the
// game's bitmaps (BitmapData, by size) and the bitmap fills of shapes (by source size), with
// how often each is drawn and the time the canvas call takes.  Installed before the clock runs;
// fps.py reads window.__sources at the end.
() => {
  const r = player.renderer;
  const out = window.__sources = {};
  const note = (k, dt) => { const e = out[k] || (out[k] = { n: 0, ms: 0 }); e.n++; e.ms += dt; };
  const P = CanvasRenderingContext2D.prototype;
  const drawImage = P.drawImage, fillRect = P.fillRect, createPattern = P.createPattern;
  let what = null;
  P.drawImage = function (...a) {
    if (this !== r.ctx || !what) return drawImage.apply(this, a);
    const t = performance.now();
    const res = drawImage.apply(this, a);
    note(what + ' ' + a[0].width + 'x' + a[0].height + (a[0].$gpu ? ' gpu' : ''), performance.now() - t);
    return res;
  };
  P.fillRect = function (...a) {
    if (this !== r.ctx || !what) return fillRect.apply(this, a);
    const t = performance.now();
    const res = fillRect.apply(this, a);
    note(what + ' fill', performance.now() - t);
    return res;
  };
  P.createPattern = function (...a) {
    if (this !== r.ctx || !what) return createPattern.apply(this, a);
    const t = performance.now();
    const res = createPattern.apply(this, a);
    note(what + ' pattern ' + a[0].width + 'x' + a[0].height, performance.now() - t);
    return res;
  };
  const dbd = r.drawBitmapData.bind(r);
  r.drawBitmapData = function (ctx, bmd, m, cx, smooth) { what = 'bmd'; try { return dbd(ctx, bmd, m, cx, smooth); } finally { what = null; } };
  const fp = r.fillPath.bind(r);
  r.fillPath = function (ctx, path, style, m, cx, lib, cm) { what = 'fill:' + style.t + (cm ? '+cm' : ''); try { return fp(ctx, path, style, m, cx, lib, cm); } finally { what = null; } };
  const dbc = r.drawBitmapChar.bind(r);
  r.drawBitmapChar = function (...a) { what = 'char' + (a[6] ? '+cm' : ''); try { return dbc(...a); } finally { what = null; } };
}
