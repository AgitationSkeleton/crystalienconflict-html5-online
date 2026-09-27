// Drawing the display list onto a canvas.
//
// Flash renders in stage coordinates (600x400 here); this renders the same scene at the
// canvas's real resolution, so the picture is the original's, only sharper where the
// original was vector.  Bitmaps follow _quality exactly as Flash 8 did: at "medium" --
// which this game sets -- bitmaps are not smoothed.

import { mul, invert, cxMul, cxIsIdentity, cxAlphaOnly, cxApplyRGBA, cssColor, cxKey, boundsOf } from './geom.js';
import { MovieClip, ShapeObj, MorphObj, TextObj, EditText, ButtonObj, BitmapObj } from './display.js';
import { GLFilters, filterPadding, scaleBlur } from './filters.js';

const SVGNS = 'http://www.w3.org/2000/svg';

// Online: the players' colours.  h is the hue a faction's accent is turned to, in degrees; s and
// v scale the accent's own saturation and value (black and tan are mostly those); plate is the
// saturation the grey baseplates are given.
export const TEAM_COLOURS = {
  orange: { h: 30, s: 1, v: 1, plate: 0.45 },
  green: { h: 95, s: 1, v: 1, plate: 0.45 },
  red: { h: 358, s: 1, v: 1, plate: 0.5 },
  blue: { h: 218, s: 1, v: 1, plate: 0.5 },
  purple: { h: 282, s: 1, v: 0.95, plate: 0.45 },
  black: { h: 0, s: 0.08, v: 0.35, plate: 0 },
  tan: { h: 36, s: 0.4, v: 1, plate: 0.25 },
  cyan: { h: 185, s: 1, v: 1, plate: 0.45 },
  yellow: { h: 54, s: 1, v: 1, plate: 0.5 },     // (well clear of orange's 30 and tan's pale 36)
  gray: { h: 0, s: 0, v: 0.9, plate: 0 },          // a spectator's sidebar
};
const TEAM_BAND = 22;             // degrees either side of the art's accent
// Command & Conquer's team key: the green the C&C mod moves each sprite's accent to, and which
// the game's client then turns to the owner's colour -- along with every other pixel of that
// green, such as the Alien riders on the Mothership, whatever the sprite's own accent.  The
// same happens here, so that a sprite is coloured as the mod's is.
const TEAM_KEY = 114;
const TEAM_MIN_SAT = 0.30;        // below this a pixel is neutral, and left alone
const TEAM_MIN_VAL = 0.15;
const MIN_STAGE_W = 600;       // the smallest stage: the original 600x400, menus and all
const MIN_STAGE_H = 400;

// A colour through a Flash colour matrix: 4 rows of [r, g, b, a, offset], offsets in 0..255.
function cmApply(cm, c) {
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    const k = row * 5;
    const v = cm[k] * c[0] + cm[k + 1] * c[1] + cm[k + 2] * c[2] + cm[k + 3] * c[3] + cm[k + 4];
    out[row] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
  return out;
}

export class Renderer {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.player = player;
    this.stageW = 600;
    this.stageH = 400;
    this.pathsIn = new WeakMap();     // path -> it in a gradient's space (see pathIn)
    this.keyParts = new Map();        // the tint cache's keys, made once (see joinKey)
    this.cmKeys = new WeakMap();      // colour matrix -> its part of a key
    this.drawCount = 0;               // drawings made, for the tint cache's use stamps
    this.cacheBuild = null;           // while a cacheAsBitmap picture is made (see drawCached)
    this.ipFrame = -1;                // smooth drawing: the frame being drawn part of the way to
    this.ipAlpha = 1;                 // the next, and how far (see smoothed())
    this.maxScale = Infinity;         // CSS pixels a stage unit may be enlarged to (the interface size)
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.tints = new Map();           // "bitmapId|cx" -> canvas, least recently used first
    this.team = undefined;            // the colour of the player whose object is being drawn
    this.tintPixels = 0;
    this.filterDefs = new Map();      // key -> { id, el }
    this.filterIds = 1;
    this.filterSvg = null;
    this.scratch = [];                // offscreen canvases for filtered objects
    this.gl = undefined;              // GLFilters, made on first use (null: not available)
    this.forceGL = false;             // use it even on a software renderer (tests)
    this.glTime = 0;                  // time spent in it, and how many runs (see glRun)
    this.glRuns = 0;
    this.fcache = new Map();          // object -> its filtered image (see drawFiltered)
    this.potent = new WeakMap();      // filter list -> the part that does something
    this.fcachePixels = 0;
    this.fcacheIds = 1;
  }

  // The stage fills the window, at least the original's 600x400 and of the window's shape:
  // enlarged to fit, but no more than maxScale CSS pixels a unit -- a bigger window than that
  // shows more instead.  The game lays itself out across what it gets (Stage.width, height).
  resize(cssW, cssH, dpr) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    const minW = this.minStageW || MIN_STAGE_W;
    const k = Math.max(1e-3, Math.min(cssW / minW, cssH / MIN_STAGE_H, this.maxScale || Infinity));
    this.stageW = Math.max(minW, Math.floor(cssW / k));
    this.stageH = Math.max(MIN_STAGE_H, Math.floor(cssH / k));
    this.scale = Math.min(w / this.stageW, h / this.stageH);
    this.offsetX = (w - this.stageW * this.scale) / 2;
    this.offsetY = (h - this.stageH * this.scale) / 2;
  }

  stageMatrix() {
    return [this.scale, 0, 0, this.scale, this.offsetX, this.offsetY];
  }

  // Canvas pixel -> stage coordinates.
  toStage(px, py) {
    return [(px - this.offsetX) / this.scale, (py - this.offsetY) / this.scale];
  }

  render(levels, background) {
    const ctx = this.ctx;
    this.drawCount++;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.offsetX, this.offsetY, this.stageW * this.scale, this.stageH * this.scale);
    ctx.clip();
    ctx.fillStyle = cssColor(background);
    ctx.fillRect(this.offsetX, this.offsetY, this.stageW * this.scale, this.stageH * this.scale);
    const sm = this.stageMatrix();
    for (const level of levels) if (level) this.draw(ctx, level, sm, null);
    ctx.restore();
  }

  // ---- the tree ----------------------------------------------------------------------
  // A clip with a teamColour draws everything below it in that player's colour.
  draw(ctx, obj, parentM, parentCx) {
    if (obj.$team === undefined) return this.drawObject(ctx, obj, parentM, parentCx);
    const outer = this.team;
    this.team = obj.$team;
    try {
      return this.drawObject(ctx, obj, parentM, parentCx);
    } finally {
      this.team = outer;
    }
  }

  drawObject(ctx, obj, parentM, parentCx) {
    if (!obj.$visible || obj.$removed || obj.$maskOf) return;     // a setMask() mask is never drawn
    if (obj.$pointer && this.hidePointer) return;                   // (online: touch has no pointer)
    const m = obj.$ipFrame === this.ipFrame || obj.$pointer ? this.smoothed(ctx, obj, parentM) : mul(parentM, obj.$m);
    const cx = cxMul(parentCx, obj.$cx);
    if (cx && cx[3] <= 0 && cx[7] <= 0) return;           // fully transparent
    if (obj.$cacheAsBitmap && this.drawCached(ctx, obj, m, cx)) return;
    if (this.cacheBuild && obj.$maskClip) this.cacheBuild.volatile = true;
    const mask = obj.$maskClip;
    if (mask && !mask.$removed) {
      // The mask sits wherever it is in the display list; express its transform relative
      // to this object so the same code works on the stage and inside BitmapData.draw.
      const rel = mul(invert(obj.$worldMatrix()), mask.$worldMatrix());
      const clip = new Path2D();
      this.collectMask(clip, mask, mul(m, rel));
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clip(clip, 'nonzero');
      const fl = this.potentFilters(obj.$filters);
      if (fl) this.drawWithFilters(ctx, obj, m, cx, fl);
      else this.drawContent(ctx, obj, m, cx);
      ctx.restore();
      return;
    }
    const fl = this.potentFilters(obj.$filters);
    if (fl) return this.drawWithFilters(ctx, obj, m, cx, fl);
    this.drawContent(ctx, obj, m, cx);
  }

  // Smooth drawing (the screen refreshes more often than the game's 23 frames a second): an
  // object a script moved in the last frame is drawn part of the way from where it was to where
  // it is, by how far the clock has got towards the next frame -- unless it was only just made
  // or shown, or it jumped (160 pixels is further than anything travels in a frame).  And the
  // game's own pointer is drawn where the mouse is now, not where it was at the last frame.
  smoothed(ctx, obj, parentM) {
    const l = obj.$m;
    if (obj.$pointer) {
      const m = mul(parentM, l);
      const mouse = this.player && this.player.mouse;
      if (ctx === this.ctx && mouse) {
        m[4] = this.offsetX + mouse[0] * this.scale;
        m[5] = this.offsetY + mouse[1] * this.scale;
      }
      return m;
    }
    const dx = l[4] - obj.$ipX, dy = l[5] - obj.$ipY;
    if (obj.$born === this.ipFrame || obj.$shown === this.ipFrame || dx * dx + dy * dy > 160 * 160) return mul(parentM, l);
    const back = 1 - this.ipAlpha;
    return mul(parentM, [l[0], l[1], l[2], l[3], l[4] - dx * back, l[5] - dy * back]);
  }

  // A colour matrix on a single shape needs no offscreen work: nothing inside one shape
  // overlaps, so filtering its colours and bitmaps is the same as filtering the result.
  // (The Christmas level has hundreds of these tiles, and a terrain 2880px square.)
  drawWithFilters(ctx, obj, m, cx, fl) {
    if (fl.length === 1 && fl[0].type === 'colorMatrix') {
      const shape = this.singleShape(obj);
      if (shape) return this.drawShape(ctx, shape, shape === obj ? m : mul(m, shape.$m), cx, fl[0].matrix);
    }
    // Online (speed): an outer glow or a drop shadow is the canvas's own shadow, cast as the
    // object draws -- no image to make offscreen and nothing to read back from the GPU, which
    // is what made a volley of laser fire (each shot glows) stall the whole frame.
    if (fl.length === 1 && (fl[0].type === 'glow' || fl[0].type === 'dropShadow') && !fl[0].inner && !fl[0].knockout) {
      return this.drawShadowed(ctx, obj, m, cx, fl[0]);
    }
    this.drawFiltered(ctx, obj, m, cx, fl);
  }

  drawShadowed(ctx, obj, m, cx, f) {
    const [r, g, b, a] = f.color;
    const alpha = Math.min(1, (a / 255) * Math.min(2, Math.max(0.5, f.strength || 1)) * 0.75);
    if (alpha <= 0) return this.drawContent(ctx, obj, m, cx);
    ctx.save();
    ctx.shadowColor = `rgba(${r},${g},${b},${alpha})`;
    ctx.shadowBlur = Math.max(1, ((f.blurX + f.blurY) / 2) * this.scale * 0.6);
    if (f.type === 'dropShadow') {
      ctx.shadowOffsetX = Math.cos(f.angle) * f.distance * this.scale;
      ctx.shadowOffsetY = Math.sin(f.angle) * f.distance * this.scale;
    }
    this.drawContent(ctx, obj, m, cx);
    ctx.restore();
  }

  singleShape(obj) {
    if (obj instanceof ShapeObj) return obj;
    if (!(obj instanceof MovieClip) || (obj.$gfx && obj.$gfx.ops.length) || obj.$children.length !== 1) return null;
    const c = obj.$children[0];
    const plain = c instanceof ShapeObj && c.$visible && !c.$removed && !c.$clipDepth && !c.$filters &&
      !c.$maskOf && !c.$maskClip && cxIsIdentity(c.$cx);
    return plain ? c : null;
  }

  // Online: a clip that keeps a picture of what it holds (cacheAsBitmap: the game asks it of
  // its shroud and its scorch marks) is drawn from that picture while nothing in it changes and
  // it is shown at the same size, the picture made at the size it is shown at.  (Zoomed out,
  // the shroud is some ten thousand tiles in one drawing.)  Not when the picture would be big
  // -- close up, where most of it is off the screen and not drawn anyway -- nor turned, filtered
  // or masked, nor while its size is changing, nor if it changes all the time or holds what
  // changes without saying so (text, a BitmapData).
  drawCached(ctx, obj, m, cx) {
    if (ctx !== this.ctx || obj.$noCache) return false;
    if (m[1] || m[2] || !(m[0] > 0) || !(m[3] > 0)) return false;
    if (cx && !(cxAlphaOnly(cx) && cx[3] <= 256)) return false;
    if (obj.$maskClip || this.potentFilters(obj.$filters)) return false;
    const e = obj.$cache || (obj.$cache = { canvas: null, key: '', want: '', since: 0, big: '', builds: [], off: 0, x0: 0, y0: 0, job: null });
    if (this.drawCount < e.off) return false;
    const key = m[0] + ',' + m[3] + ',' + (this.team || '');
    if (e.canvas && e.key === key && (!obj.$stale || this.mendCache(e, obj))) return this.blitCache(ctx, e, m, cx);
    // (Only once it has been shown at this size for a few drawings: not while zooming.)
    if (e.want !== key) {
      e.want = key;
      e.since = this.drawCount;
      e.job = null;
      return false;
    }
    if (this.drawCount - e.since < 3 || e.big === key) return false;
    if (e.job && e.job.key === key && !obj.$staleAll) return this.buildSome(e, obj, m, cx);
    const b = obj.$localBounds();
    if (!b) return false;
    const w = Math.ceil((b[2] - b[0]) * m[0]) + 2, h = Math.ceil((b[3] - b[1]) * m[3]) + 2;
    if (w > 8192 || h > 8192 || w * h > 8e6) {
      e.big = key;
      e.canvas = null;
      return false;
    }
    // (Made again more than eight times in a second: it changes too often to keep; for a while
    // it is drawn as it is.)
    e.builds.push(this.drawCount);
    while (e.builds[0] < this.drawCount - 60) e.builds.shift();
    if (e.builds.length > 8) {
      e.builds.length = 0;
      e.off = this.drawCount + 300;
      e.canvas = null;
      e.job = null;
      return false;
    }
    // A new picture, made a few milliseconds at a time (buildSome); the old one is gone.
    let canvas = e.canvas;
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
    }
    e.canvas = null;
    e.key = '';
    const kids = obj.$children;
    // Children are indexed (for mending) unless the clip draws under them itself, masks some
    // with others, or filters them (a filter draws outside what a child holds); and made a few
    // at a time unless there are masks.
    const plain = !(obj.$gfx && obj.$gfx.ops.length) && !kids.some((c) => c.$clipDepth);
    const indexed = plain && !kids.some((c) => c.$filters);
    e.job = { key, b, canvas, M: [m[0], 0, 0, m[3], 1 - b[0] * m[0], 1 - b[1] * m[3]], next: -1, plain,
      kids: indexed ? new Map() : null, order: indexed ? new Map() : null, grid: indexed ? new Map() : null };
    obj.$stale = false;
    obj.$staleAll = false;
    if (obj.$staleKids) obj.$staleKids.clear();
    return this.buildSome(e, obj, m, cx);
  }

  // Some more of a picture in the making: its children in order, for a few milliseconds.  When
  // it is done, what changed meanwhile is mended and it is shown; till then the clip is drawn as
  // it is (false).
  buildSome(e, obj, m, cx) {
    const job = e.job;
    const g = job.canvas.getContext('2d');
    const ip = this.ipFrame, outer = this.cacheBuild;
    const build = this.cacheBuild = { volatile: false };
    this.ipFrame = -1;
    const kids = obj.$children;
    try {
      if (job.next < 0) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, job.canvas.width, job.canvas.height);
        job.next = 0;
        if (!job.plain) {
          this.drawContent(g, obj, job.M, null);
          job.next = kids.length;
        }
      }
      const until = performance.now() + 3;
      while (job.next < kids.length) {
        const c = kids[job.next];
        this.draw(g, c, job.M, null);
        if (job.kids) {
          job.order.set(c, job.next);
          const r = this.kidBounds(job, c);
          job.kids.set(c, r);
          if (r) this.gridPut(job, c, r, true);
        }
        job.next++;
        if ((job.next & 31) === 0 && performance.now() > until) break;
      }
    } finally {
      this.ipFrame = ip;
      this.cacheBuild = outer;
    }
    if (build.volatile) {
      obj.$noCache = true;
      obj.$cache = null;
      return false;
    }
    if (job.next < kids.length) return false;
    e.job = null;
    e.canvas = job.canvas;
    e.key = job.key;
    e.x0 = job.b[0];
    e.y0 = job.b[1];
    e.M = job.M;
    e.kids = job.kids;
    e.order = job.order;
    e.grid = job.grid;
    if (obj.$stale && !this.mendCache(e, obj)) {
      e.key = '';
      return false;
    }
    return this.blitCache(this.ctx, e, m, cx);
  }

  // A child's box in a picture (e, or a picture in the making), in whole pixels and a little
  // over (for anti-aliased edges).
  kidBounds(e, c) {
    if (!c.$visible || c.$removed) return null;
    const lb = c.$localBounds();
    if (!lb) return null;
    const d = boundsOf(mul(e.M, c.$m), lb);
    const W = e.canvas.width, H = e.canvas.height;
    const r = [Math.max(0, Math.floor(d[0]) - 2), Math.max(0, Math.floor(d[1]) - 2), Math.min(W, Math.ceil(d[2]) + 2), Math.min(H, Math.ceil(d[3]) + 2)];
    return r[2] > r[0] && r[3] > r[1] ? r : null;
  }

  // Which children touch each 256-pixel square of a picture (for mending it).
  gridPut(e, c, r, add) {
    for (let gy = r[1] >> 8; gy <= (r[3] - 1) >> 8; gy++) {
      for (let gx = r[0] >> 8; gx <= (r[2] - 1) >> 8; gx++) {
        const k = gy * 65536 + gx;
        let cell = e.grid.get(k);
        if (add) {
          if (!cell) e.grid.set(k, (cell = []));
          cell.push(c);
        } else if (cell) {
          const i = cell.indexOf(c);
          if (i >= 0) cell.splice(i, 1);
        }
      }
    }
  }

  // Mend a cached clip's picture where the children that changed are and were: each such box
  // cleared and drawn again, with every child that touches it, in their order.  False when it
  // has to be made again instead (the clip itself changed, a child came or went, or too many
  // changed to be worth it).
  mendCache(e, obj) {
    const kids = obj.$staleKids;
    if (!e.kids || obj.$staleAll || !kids || !kids.size || kids.size > 400) return false;
    for (const k of kids) if (!e.kids.has(k)) return false;
    const boxes = [];
    for (const k of kids) {
      const was = e.kids.get(k);
      const now = this.kidBounds(e, k);
      if (was) {
        boxes.push(was);
        this.gridPut(e, k, was, false);
      }
      if (now) {
        boxes.push(now);
        this.gridPut(e, k, now, true);
      }
      e.kids.set(k, now);
    }
    kids.clear();
    obj.$stale = false;
    const g = e.canvas.getContext('2d');
    const ip = this.ipFrame;
    this.ipFrame = -1;
    try {
      for (const r of boxes) {
        const touch = new Set();
        for (let gy = r[1] >> 8; gy <= (r[3] - 1) >> 8; gy++) {
          for (let gx = r[0] >> 8; gx <= (r[2] - 1) >> 8; gx++) {
            const cell = e.grid.get(gy * 65536 + gx);
            if (cell) for (const c of cell) touch.add(c);
          }
        }
        const draw = [];
        for (const c of touch) {
          const b = e.kids.get(c);
          if (b && b[0] < r[2] && b[2] > r[0] && b[1] < r[3] && b[3] > r[1]) draw.push(c);
        }
        draw.sort((a, b) => e.order.get(a) - e.order.get(b));
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.beginPath();
        g.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
        g.clip();
        g.clearRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
        for (const c of draw) this.draw(g, c, e.M, null);
        g.restore();
      }
    } finally {
      this.ipFrame = ip;
    }
    return true;
  }

  blitCache(ctx, e, m, cx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = cx ? Math.max(0, cx[3] / 256) : 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(e.canvas, Math.round(m[4] + e.x0 * m[0] - 1), Math.round(m[5] + e.y0 * m[3] - 1));
    ctx.globalAlpha = 1;
    return true;
  }

  drawContent(ctx, obj, m, cx) {
    if (this.cacheBuild && (obj instanceof EditText || obj instanceof BitmapObj)) this.cacheBuild.volatile = true;
    if (obj instanceof MovieClip) {
      if (obj.$gfx && obj.$gfx.ops.length) this.drawGraphics(ctx, obj.$gfxFrame === this.ipFrame && obj.$gfxPrev ? this.blendedGfx(obj) : obj.$gfx, m, cx);
      this.drawChildren(ctx, obj.$children, m, cx);
    } else if (obj instanceof ShapeObj) {
      this.drawShape(ctx, obj, m, cx);
    } else if (obj instanceof ButtonObj) {
      this.drawChildren(ctx, obj.$children, m, cx);
    } else if (obj instanceof EditText) {
      this.player.text.draw(ctx, obj, m, cx, this);
    } else if (obj instanceof TextObj) {
      this.drawStaticText(ctx, obj, m, cx);
    } else if (obj instanceof MorphObj) {
      this.drawMorph(ctx, obj, m, cx);
    } else if (obj instanceof BitmapObj) {
      this.drawBitmapData(ctx, obj.$bmd, m, cx, obj.$smooth);
    }
  }

  drawChildren(ctx, children, m, cx) {
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c.$cullable && this.offCanvas(ctx, c, m)) continue;
      if (c.$clipDepth) {
        // A mask: everything above it up to clipDepth is drawn through its shape.
        let j = i + 1;
        while (j < children.length && children[j].$depth <= c.$clipDepth) j++;
        const masked = children.slice(i + 1, j);
        // A mask applies whether or not the mask itself is visible.
        ctx.save();
        const clip = new Path2D();
        this.collectMask(clip, c, mul(m, c.$m));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clip(clip, 'nonzero');
        for (const mc of masked) this.draw(ctx, mc, m, cx);
        ctx.restore();
        i = j - 1;
        continue;
      }
      this.draw(ctx, c, m, cx);
    }
  }

  // Online: is a cullable clip (a map tile, a patch of shroud) wholly off the canvas?  A big
  // map has tens of thousands of them, and drawing them all every frame is most of a frame.
  // Their bounds are kept for the frame they show.
  offCanvas(ctx, c, parentM) {
    if (c.$cullFrame !== c.$cur || !c.$cullBox) {
      c.$cullBox = c.$localBounds();
      c.$cullFrame = c.$cur;
    }
    const b = c.$cullBox;
    if (!b) return false;
    const pad = 4;
    const pm = parentM, cm = c.$m;
    if (!pm[1] && !pm[2] && !cm[1] && !cm[2]) {
      // (Neither turned nor skewed, as tiles are: the box's corners are two numbers each way.)
      const sx = pm[0] * cm[0], sy = pm[3] * cm[3];
      const tx = pm[0] * cm[4] + pm[4], ty = pm[3] * cm[5] + pm[5];
      let x0 = sx * b[0] + tx, x1 = sx * b[2] + tx, y0 = sy * b[1] + ty, y1 = sy * b[3] + ty;
      if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
      if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
      return x1 < -pad || y1 < -pad || x0 > ctx.canvas.width + pad || y0 > ctx.canvas.height + pad;
    }
    const d = boundsOf(mul(parentM, c.$m), b);
    return d[2] < -pad || d[3] < -pad || d[0] > ctx.canvas.width + pad || d[1] > ctx.canvas.height + pad;
  }

  collectMask(path, obj, m) {
    const dm = new DOMMatrix(m);
    if (obj instanceof ShapeObj) {
      const ch = obj.$char;
      if (ch.bmp) {
        const r = new Path2D();
        r.rect(ch.b[0], ch.b[1], ch.b[2] - ch.b[0], ch.b[3] - ch.b[1]);
        path.addPath(r, dm);
      } else {
        ch.layers.forEach((L, li) => L.fills.forEach((f, fi) => {
          path.addPath(obj.$lib.path(`${obj.$cid}:${li}:f${fi}`, f.p), dm);
        }));
      }
    } else if (obj instanceof MovieClip) {
      for (const c of obj.$children) if (!c.$clipDepth) this.collectMask(path, c, mul(m, c.$m));
    } else if (obj instanceof MorphObj) {
      const p = this.morphPaths(obj);
      for (const f of p.fills) path.addPath(f.path, dm);
    }
  }

  // ---- shapes ------------------------------------------------------------------------
  setTransform(ctx, m) {
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  }

  // An unrotated bitmap is drawn with its edges on whole pixels.  The map is a grid of
  // 96x48 tiles (terrain, and the shroud over it); at 600x400 their edges fall exactly on
  // pixels, as they did in Flash, but scaled to the window they would fall between pixels
  // and their anti-aliased edges would let what is behind show through as grid lines.
  snapped(m, w, h) {
    if (m[1] !== 0 || m[2] !== 0 || !w || !h) return m;
    const x0 = Math.round(m[4]), x1 = Math.round(m[4] + m[0] * w);
    const y0 = Math.round(m[5]), y1 = Math.round(m[5] + m[3] * h);
    if (x0 === x1 || y0 === y1) return m;
    return [(x1 - x0) / w, 0, 0, (y1 - y0) / h, x0, y0];
  }

  // Flash 8: at low and medium quality bitmaps are never smoothed; at high and best
  // they are smoothed where the fill asks for it.
  smoothing(flagged) {
    const q = this.player.quality;
    return (q === 'high' || q === 'best') && !!flagged;
  }

  // cm: a colour matrix to put the shape's colours through first (see drawWithFilters).
  drawShape(ctx, obj, m, cx, cm) {
    const ch = obj.$char;
    if (ch.bmp) return this.drawBitmapChar(ctx, ch.bmp.id, mul(m, ch.bmp.m), cx, obj.$lib, ch.bmp.smooth, cm);
    for (let li = 0; li < ch.layers.length; li++) {
      const L = ch.layers[li];
      for (let fi = 0; fi < L.fills.length; fi++) {
        const f = L.fills[fi];
        const path = obj.$lib.path(`${obj.$cid}:${li}:f${fi}`, f.p);
        this.fillPath(ctx, path, f.s, m, cx, obj.$lib, cm);
      }
      for (let i = 0; i < L.lines.length; i++) {
        const l = L.lines[i];
        const path = obj.$lib.path(`${obj.$cid}:${li}:l${i}`, l.p);
        this.strokePath(ctx, path, l.s, m, cx, cm);
      }
    }
  }

  fillPath(ctx, path, style, m, cx, lib, cm) {
    this.setTransform(ctx, m);
    ctx.globalAlpha = 1;
    const t = style.t;
    const colour = (c) => cxApplyRGBA(cx, cm ? cmApply(cm, c) : c);
    if (t === 'solid') {
      ctx.fillStyle = cssColor(colour(style.c));
      ctx.fill(path, 'evenodd');
    } else if (t === 'linear' || t === 'radial' || t === 'focal') {
      const g = style.m;
      // Gradients live in a +/-819.2px square; the shape is filled in that space (taken there
      // by the inverse of the gradient's matrix).  (Not a square of gradient clipped to the
      // shape: the browser makes a clip as a mask on the CPU, at every drawing.)
      const inGradient = this.pathIn(path, g);
      if (!inGradient) return;
      this.setTransform(ctx, mul(m, g));
      let grad;
      if (t === 'linear') grad = ctx.createLinearGradient(-819.2, 0, 819.2, 0);
      else {
        const fx = t === 'focal' ? (style.focal || 0) * 819.2 : 0;
        grad = ctx.createRadialGradient(fx, 0, 0, 0, 0, 819.2);
      }
      for (const [ratio, col] of style.stops) grad.addColorStop(ratio / 255, cssColor(colour(col)));
      ctx.fillStyle = grad;
      ctx.fill(inGradient, 'evenodd');
    } else if (t === 'bitmap') {
      // The shape filled with the bitmap as a pattern (not a rectangle of it clipped to the
      // shape, as above).
      const src = this.bitmapSource(style.id, cx, lib, cm);
      const p = src && this.pattern(ctx, src, style.repeat, style.m);
      if (!p) return;
      ctx.imageSmoothingEnabled = this.smoothing(style.smooth);
      ctx.fillStyle = p;
      ctx.fill(path, 'evenodd');
    }
  }

  // A pattern of an image placed by the matrix m (from the image to the space being filled),
  // repeated or once.
  pattern(ctx, img, repeat, m) {
    const p = ctx.createPattern(img, repeat ? 'repeat' : 'no-repeat');
    if (p) p.setTransform({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] });
    return p;
  }

  // A path taken into the space of the matrix g (by g's inverse), kept with the path for as
  // long as g is the same.  Null when g flattens everything (nothing to fill).
  pathIn(path, g) {
    const key = g.join(',');
    const had = this.pathsIn.get(path);
    if (had && had.key === key) return had.p;
    const det = g[0] * g[3] - g[1] * g[2];
    let p = null;
    if (det && Number.isFinite(det)) {
      const [a, b, c, d, e, f] = invert(g);
      p = new Path2D();
      p.addPath(path, { a, b, c, d, e, f });
    }
    this.pathsIn.set(path, { key, p });
    return p;
  }

  strokePath(ctx, path, style, m, cx, cm) {
    this.setTransform(ctx, m);
    ctx.globalAlpha = 1;
    const c = style.c || [0, 0, 0, 255];
    const col = cxApplyRGBA(cx, cm ? cmApply(cm, c) : c);
    ctx.strokeStyle = cssColor(col);
    // Width 0 is a hairline: one device pixel at any scale.
    const sx = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
    const w = style.w;
    ctx.lineWidth = w > 0 ? Math.max(w, 1 / Math.max(sx, 1e-6)) : 1 / Math.max(sx, 1e-6);
    ctx.lineCap = style.startCap === 'none' ? 'butt' : style.startCap || 'round';
    ctx.lineJoin = style.join || 'round';
    if (style.miter) ctx.miterLimit = style.miter;
    ctx.stroke(path);
  }

  // ---- bitmaps -----------------------------------------------------------------------
  bitmapSource(id, cx, lib, cm) {
    let img = lib.bitmaps.get(id);
    if (!img) return null;
    let key = this.bitmapKey(lib, id);
    if (this.team) [img, key] = this.teamed(key, img, id, lib, this.team);
    if (cm) [img, key] = this.colourMatrixed(key, img, cm);
    if (cxIsIdentity(cx)) return img;
    return this.tinted(key, img, cx);
  }

  // A bitmap put through a colour matrix (on unpremultiplied colour, as Flash's filter),
  // kept in the same cache as tints.  Returns [image, cache key].
  colourMatrixed(key, img, cm) {
    let part = this.cmKeys.get(cm);
    if (part === undefined) this.cmKeys.set(cm, (part = '|cm:' + cm.join(',')));
    const k = this.joinKey(key, part);
    let c = this.tints.get(k);
    if (c) {
      c.$used = this.drawCount;
      return [c, k];
    }
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    if (w && h) {
      const d = g.getImageData(0, 0, w, h);
      const p = d.data;
      const px = [0, 0, 0, 0];
      for (let i = 0; i < p.length; i += 4) {
        px[0] = p[i]; px[1] = p[i + 1]; px[2] = p[i + 2]; px[3] = p[i + 3];
        const o = cmApply(cm, px);
        p[i] = o[0]; p[i + 1] = o[1]; p[i + 2] = o[2]; p[i + 3] = o[3];
      }
      g.putImageData(d, 0, 0);
    }
    this.tints.set(k, c);
    this.tintPixels += w * h;
    this.trimTints();
    return [c, k];
  }

  // Online: a library bitmap in a player's colour.  Pixels of the art's accent (its hue, from
  // tools/team_accents.py, within TEAM_BAND and saturated enough to be a colour at all) take
  // the colour's hue and keep their own saturation and value, so the shading stays; pixels of
  // the C&C key green (TEAM_KEY) turn with them, keeping their offset from it; a grey
  // baseplate (accent -1) is coloured all over, and a white cloth (-2, the flag's) where it
  // is pale.  Art already in that colour, and art with no
  // accent, is left alone, as are the pixels an accent keeps (rows of [y, first x, last x]: the
  // pizza in the pizza box).  An accent may say more (its fifth part, for the sidebar's
  // pictures, tools/make_mugshots.py): shade, how much of each pixel's own difference from the
  // accent's hue it keeps (the accent is a gradient, not one hue); minSat, how pale a pixel may
  // be and still be coloured; colours, a player's colour of its own for this art (a black that
  // is not so dark).  Returns [image, cache key], in the tints cache.
  teamed(key, img, id, lib, team) {
    const accent = lib.accents && lib.accents[id];
    const opts = (accent && accent[4]) || {};
    const colour = (opts.colours && opts.colours[team]) || TEAM_COLOURS[team];
    if (!colour || !accent || accent[1] === team) return [img, key];
    const k = this.joinKey(key, '|team:' + team);
    let c = this.tints.get(k);
    if (c) {
      c.$used = this.drawCount;
      return [c, k];
    }
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    if (w && h) {
      const d = g.getImageData(0, 0, w, h);
      const p = d.data;
      const plate = accent[0] === -1;
      const cloth = accent[0] === -2;
      const centre = accent[0];
      const keep = new Map();         // row -> [first x, last x, first x, last x, ...]
      for (const [ky, x0, x1] of accent[2] || []) {
        const spans = keep.get(ky);
        if (spans) spans.push(x0, x1);
        else keep.set(ky, [x0, x1]);
      }
      const band = accent[3] || TEAM_BAND;     // (wider for a few: tools/team_accents.py)
      const shade = opts.shade || 0;
      const minSat = opts.minSat === undefined ? TEAM_MIN_SAT : opts.minSat;
      for (let i = 0; i < p.length; i += 4) {
        if (!p[i + 3]) continue;
        if (keep.size) {
          const row = keep.get(Math.floor(i / 4 / w));
          const x = (i / 4) % w;
          let kept = false;
          for (let j = 0; row && j < row.length && !kept; j += 2) kept = x >= row[j] && x <= row[j + 1];
          if (kept) continue;
        }
        const r = p[i] / 255, gr = p[i + 1] / 255, b = p[i + 2] / 255;
        const max = Math.max(r, gr, b), min = Math.min(r, gr, b), delta = max - min;
        let hue, sat, pale = false;
        const val = max;
        if (plate) {
          sat = colour.plate;
        } else if (cloth) {
          if (val < 0.45 || (max ? delta / max : 0) > 0.25) continue;
          sat = Math.min(1, 0.8 * colour.s);
          hue = colour.h;
        } else {
          sat = max ? delta / max : 0;
          if (sat < minSat || val < TEAM_MIN_VAL || !delta) continue;
          pale = sat < TEAM_MIN_SAT;
          if (max === r) hue = 60 * (((gr - b) / delta) % 6);
          else if (max === gr) hue = 60 * ((b - r) / delta + 2);
          else hue = 60 * ((r - gr) / delta + 4);
          if (hue < 0) hue += 360;
          const off = ((hue - centre + 540) % 360) - 180;     // (-180..180)
          let turn = hue - TEAM_KEY;
          if (turn > 180) turn -= 360;
          if (Math.abs(off) <= band) turn = off * shade;
          else if (Math.abs(turn) > TEAM_BAND) continue;
          hue = (colour.h + turn + 360) % 360;
          sat *= colour.s;
        }
        if (plate) hue = colour.h;
        // (a pale pixel, coloured only for an accent's minSat, keeps its brightness: a highlight)
        const v = pale ? val : Math.min(1, val * colour.v);
        const s = Math.min(1, sat);
        // HSV back to RGB, at the new hue.
        const hh = hue / 60, f = hh - Math.floor(hh);
        const pp = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
        let rr, gg, bb;
        switch (Math.floor(hh) % 6) {
          case 0: rr = v; gg = t; bb = pp; break;
          case 1: rr = q; gg = v; bb = pp; break;
          case 2: rr = pp; gg = v; bb = t; break;
          case 3: rr = pp; gg = q; bb = v; break;
          case 4: rr = t; gg = pp; bb = v; break;
          default: rr = v; gg = pp; bb = q; break;
        }
        p[i] = Math.round(rr * 255);
        p[i + 1] = Math.round(gg * 255);
        p[i + 2] = Math.round(bb * 255);
      }
      g.putImageData(d, 0, 0);
    }
    this.tints.set(k, c);
    this.tintPixels += w * h;
    this.trimTints();
    return [c, k];
  }

  // A library bitmap in a player's colour, as a canvas (for BitmapData.loadBitmap).
  teamedImage(lib, id, team) {
    const img = lib.bitmaps.get(id);
    if (!img) return null;
    return this.teamed(`${lib.movie}:${id}`, img, id, lib, team)[0];
  }

  tinted(key, img, cx) {
    const k = this.joinKey(key, '|' + cxKey(cx));
    let c = this.tints.get(k);
    if (c) {
      c.$used = this.drawCount;
      return c;
    }
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    if (w && h) {
      const d = g.getImageData(0, 0, w, h);
      const p = d.data;
      const [rm, gm, bm, am, ra, ga, ba, aa] = cx;
      for (let i = 0; i < p.length; i += 4) {
        let v = ((p[i] * rm) >> 8) + ra; p[i] = v < 0 ? 0 : v > 255 ? 255 : v;
        v = ((p[i + 1] * gm) >> 8) + ga; p[i + 1] = v < 0 ? 0 : v > 255 ? 255 : v;
        v = ((p[i + 2] * bm) >> 8) + ba; p[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
        v = ((p[i + 3] * am) >> 8) + aa; p[i + 3] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      g.putImageData(d, 0, 0);
    }
    this.tints.set(k, c);
    this.tintPixels += w * h;
    this.trimTints();
    return c;
  }

  // Colour tweens make a new tint every frame, and six players' colours a copy of each of
  // their sprites: keep the most recently drawn, about 128MB of them.  (Online, speed: a hit
  // only stamps its entry with the drawing it was used in; when the cache is too big, the
  // least recently used go, down to three quarters of it, so that it is not sorted again at
  // the next new entry.)
  trimTints() {
    if (this.tintPixels <= 32e6 || this.tints.size <= 1) return;
    const byUse = [...this.tints.entries()].sort((a, b) => (a[1].$used || 0) - (b[1].$used || 0));
    for (const [k, c] of byUse) {
      if (this.tintPixels <= 24e6 || this.tints.size <= 1) break;
      this.tints.delete(k);
      this.tintPixels -= c.width * c.height;
    }
  }

  // a + b, the same string each time (a frame asks for the same keys thousands of times).
  joinKey(a, b) {
    let m = this.keyParts.get(a);
    if (!m) this.keyParts.set(a, (m = new Map()));
    let k = m.get(b);
    if (k === undefined) m.set(b, (k = a + b));
    return k;
  }

  bitmapKey(lib, id) {
    const keys = lib.$keys || (lib.$keys = new Map());
    let k = keys.get(id);
    if (k === undefined) keys.set(id, (k = `${lib.movie}:${id}`));
    return k;
  }

  drawBitmapChar(ctx, id, m, cx, lib, smooth, cm) {
    let img = lib.bitmaps.get(id);
    if (!img) return;
    let key = this.bitmapKey(lib, id);
    if (this.team) [img, key] = this.teamed(key, img, id, lib, this.team);
    if (cm) [img, key] = this.colourMatrixed(key, img, cm);
    this.setTransform(ctx, this.snapped(m, img.width, img.height));
    ctx.imageSmoothingEnabled = this.smoothing(smooth);
    if (cxIsIdentity(cx)) {
      ctx.globalAlpha = 1;
      ctx.drawImage(img, 0, 0);
    } else if (cxAlphaOnly(cx) && cx[3] <= 256 && cx[7] === 0) {
      ctx.globalAlpha = Math.max(0, cx[3] / 256);
      ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 1;
      ctx.drawImage(this.tinted(key, img, cx), 0, 0);
    }
  }

  drawBitmapData(ctx, bmd, m, cx, smooth) {
    this.setTransform(ctx, m);
    ctx.imageSmoothingEnabled = this.smoothing(smooth);
    const src = bmd.$canvas;
    if (cxIsIdentity(cx)) {
      ctx.globalAlpha = 1;
      ctx.drawImage(src, 0, 0);
    } else if (cxAlphaOnly(cx) && cx[3] <= 256) {
      ctx.globalAlpha = Math.max(0, cx[3] / 256);
      ctx.drawImage(src, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      ctx.drawImage(this.tinted(`bmd${bmd.$id}:${bmd.$version}`, src, cx), 0, 0);
    }
  }

  // ---- the drawing API ------------------------------------------------------------------
  // Smooth drawing: a clip drawn again in the last frame, by the same steps as before (the same
  // kinds of line, fill and move, the same bitmaps), is drawn with its numbers part of the way
  // from the old drawing's to the new -- points and bitmap fills' placings -- unless one of them
  // jumped (160 pixels).  Otherwise, or drawn differently, it is the new drawing.
  blendedGfx(obj) {
    const now = obj.$gfx, was = obj.$gfxPrev;
    if (now.$blendFrom !== was) {
      now.$blendFrom = was;
      now.$blendable = this.sameSteps(was.ops, now.ops);
    }
    if (!now.$blendable) return now;
    const t = this.ipAlpha, a = was.ops, b = now.ops;
    const ops = new Array(b.length);
    for (let i = 0; i < b.length; i++) {
      const p = a[i], q = b[i];
      switch (q[0]) {
        case 'm':
        case 'l':
          ops[i] = [q[0], p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
          break;
        case 'q':
          ops[i] = ['q', p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t, p[3] + (q[3] - p[3]) * t, p[4] + (q[4] - p[4]) * t];
          break;
        case 'bb': {
          const pm = p[1].m, qm = q[1].m;
          ops[i] = ['bb', Object.assign({}, q[1], { m: qm.map((v, k) => pm[k] + (v - pm[k]) * t) })];
          break;
        }
        default:
          ops[i] = q;
      }
    }
    return { ops, bounds: now.bounds };
  }

  sameSteps(a, b) {
    if (!a || a.length !== b.length) return false;
    const far = (x, y) => Math.abs(x - y) > 160;
    for (let i = 0; i < b.length; i++) {
      const p = a[i], q = b[i];
      if (p[0] !== q[0]) return false;
      if (q[0] === 'm' || q[0] === 'l') {
        if (far(p[1], q[1]) || far(p[2], q[2])) return false;
      } else if (q[0] === 'q') {
        if (far(p[1], q[1]) || far(p[2], q[2]) || far(p[3], q[3]) || far(p[4], q[4])) return false;
      } else if (q[0] === 'bb') {
        const pm = p[1].m, qm = q[1].m;
        if (p[1].bmd !== q[1].bmd || far(pm[4], qm[4]) || far(pm[5], qm[5])) return false;
        for (let k = 0; k < 4; k++) if (Math.abs(pm[k] - qm[k]) > 0.5) return false;
      }
    }
    return true;
  }

  drawGraphics(ctx, g, m, cx) {
    let fill = null;        // {kind, style}
    let fillPath = null;
    let strokeStyle = null;
    let strokePath = null;
    let pen = [0, 0];
    const flushStroke = () => {
      if (strokeStyle && strokePath) {
        this.setTransform(ctx, m);
        const col = cxApplyRGBA(cx, [(strokeStyle.c >> 16) & 255, (strokeStyle.c >> 8) & 255, strokeStyle.c & 255,
          Math.max(0, Math.min(255, Math.round(strokeStyle.a * 2.55)))]);
        ctx.strokeStyle = cssColor(col);
        const sx = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
        ctx.lineWidth = strokeStyle.w > 0 ? strokeStyle.w : 1 / Math.max(sx, 1e-6);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 1;
        ctx.stroke(strokePath);
      }
      strokePath = null;
    };
    const flushFill = () => {
      if (fill && fillPath) {
        this.setTransform(ctx, m);
        ctx.globalAlpha = 1;
        if (fill.kind === 'solid') {
          const s = fill.style;
          ctx.fillStyle = cssColor(cxApplyRGBA(cx, [(s.c >> 16) & 255, (s.c >> 8) & 255, s.c & 255,
            Math.max(0, Math.min(255, Math.round(s.a * 2.55)))]));
          ctx.fill(fillPath, 'evenodd');
        } else if (fill.kind === 'bitmap') {
          // (As fillPath's bitmap fills: the shape filled with a pattern, not clipped.  Faded
          // only, it fades by the canvas's alpha rather than by a faded copy.)
          const s = fill.style;
          const bmd = s.bmd;
          const src = bmd && (bmd.$canvas || null);
          if (src) {
            let img = src;
            if (cxIsIdentity(cx)) ctx.globalAlpha = 1;
            else if (cxAlphaOnly(cx) && cx[3] <= 256 && cx[7] === 0) ctx.globalAlpha = Math.max(0, cx[3] / 256);
            else img = this.tinted(`bmd${bmd.$id}:${bmd.$version}`, src, cx);
            const p = this.pattern(ctx, img, s.repeat, s.m);
            if (p) {
              ctx.imageSmoothingEnabled = this.smoothing(s.smooth);
              ctx.fillStyle = p;
              ctx.fill(fillPath, 'evenodd');
            }
            ctx.globalAlpha = 1;
          }
        }
      }
      fillPath = null;
    };
    for (const op of g.ops) {
      switch (op[0]) {
        case 'ls':
          flushStroke();
          strokeStyle = op[1];
          break;
        case 'bf':
          flushFill();
          fill = { kind: 'solid', style: op[1] };
          fillPath = new Path2D();
          fillPath.moveTo(pen[0], pen[1]);
          break;
        case 'bb':
          flushFill();
          fill = { kind: 'bitmap', style: op[1] };
          fillPath = new Path2D();
          fillPath.moveTo(pen[0], pen[1]);
          break;
        case 'ef':
          flushFill();
          fill = null;
          break;
        case 'm':
          pen = [op[1], op[2]];
          if (fillPath) fillPath.moveTo(op[1], op[2]);
          if (strokeStyle) {
            if (!strokePath) strokePath = new Path2D();
            strokePath.moveTo(op[1], op[2]);
          }
          break;
        case 'l':
          if (fillPath) fillPath.lineTo(op[1], op[2]);
          if (strokeStyle) {
            if (!strokePath) { strokePath = new Path2D(); strokePath.moveTo(pen[0], pen[1]); }
            strokePath.lineTo(op[1], op[2]);
          }
          pen = [op[1], op[2]];
          break;
        case 'q':
          if (fillPath) fillPath.quadraticCurveTo(op[1], op[2], op[3], op[4]);
          if (strokeStyle) {
            if (!strokePath) { strokePath = new Path2D(); strokePath.moveTo(pen[0], pen[1]); }
            strokePath.quadraticCurveTo(op[1], op[2], op[3], op[4]);
          }
          pen = [op[3], op[4]];
          break;
        default:
          break;
      }
    }
    flushFill();
    flushStroke();
  }

  // ---- morph shapes -----------------------------------------------------------------------
  morphPaths(obj) {
    const ch = obj.$char;
    const t = obj.$ratio / 65535;
    const lerp = (a, b) => a + (b - a) * t;
    const fills = new Map();
    const lines = new Map();
    let f0 = 0, f1 = 0, ln = 0;
    const E0 = ch.start, E1 = ch.end;
    let k1 = 0;
    for (let i = 0; i < E0.length; i++) {
      const a = E0[i];
      if (a[0] === 'M') {
        f0 = a[3]; f1 = a[4]; ln = a[5];
        continue;
      }
      while (k1 < E1.length && E1[k1][0] === 'M') k1++;
      const b = E1[k1++] || a;
      const seg = (e) => (e[0] === 'L' ? [e[1], e[2], (e[1] + e[3]) / 2, (e[2] + e[4]) / 2, e[3], e[4]] : [e[1], e[2], e[3], e[4], e[5], e[6]]);
      const sa = seg(a), sb = seg(b);
      const s = sa.map((v, j) => lerp(v, sb[j]));
      const edge = s;
      const add = (map, idx, rev) => {
        if (!idx) return;
        if (!map.has(idx)) map.set(idx, []);
        map.get(idx).push(rev ? [edge[4], edge[5], edge[2], edge[3], edge[0], edge[1]] : edge);
      };
      add(fills, f1, false);
      add(fills, f0, true);
      add(lines, ln, false);
    }
    const toPath = (segs) => {
      const p = new Path2D();
      let last = null;
      for (const s of segs) {
        if (!last || last[0] !== s[0] || last[1] !== s[1]) p.moveTo(s[0], s[1]);
        p.quadraticCurveTo(s[2], s[3], s[4], s[5]);
        last = [s[4], s[5]];
      }
      return p;
    };
    // A fill's edges arrive in drawing order, the fill-0 ones reversed; join them end to
    // start into closed loops (as tools/swf/shapes.py does for ordinary shapes).
    const key = (x, y) => Math.round(x * 100) + ',' + Math.round(y * 100);
    const toLoops = (segs) => {
      const byStart = new Map();
      segs.forEach((s, i) => {
        const k = key(s[0], s[1]);
        if (!byStart.has(k)) byStart.set(k, []);
        byStart.get(k).push(i);
      });
      const used = new Uint8Array(segs.length);
      const p = new Path2D();
      for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        used[i] = 1;
        let s = segs[i];
        const first = key(s[0], s[1]);
        p.moveTo(s[0], s[1]);
        for (;;) {
          p.quadraticCurveTo(s[2], s[3], s[4], s[5]);
          const k = key(s[4], s[5]);
          if (k === first) break;
          const next = (byStart.get(k) || []).find((j) => !used[j]);
          if (next === undefined) break;
          used[next] = 1;
          s = segs[next];
        }
        p.closePath();
      }
      return p;
    };
    const lerpC = (c0, c1) => c0.map((v, j) => Math.round(lerp(v, c1[j])));
    return {
      fills: [...fills].map(([i, segs]) => ({ style: ch.fills[i - 1], path: toLoops(segs) })),
      lines: [...lines].map(([i, segs]) => ({ style: ch.lines[i - 1], path: toPath(segs) })),
      lerp, lerpC,
    };
  }

  drawMorph(ctx, obj, m, cx) {
    const P = this.morphPaths(obj);
    for (const f of P.fills) {
      const s = f.style;
      if (!s) continue;
      if (s.t === 'solid') {
        this.setTransform(ctx, m);
        ctx.fillStyle = cssColor(cxApplyRGBA(cx, P.lerpC(s.c0, s.c1)));
        ctx.fill(f.path, 'evenodd');
      } else if (s.t === 'bitmap') {
        const t = obj.$ratio / 65535;
        const bm = s.m0.map((v, j) => v + (s.m1[j] - v) * t);
        this.fillPath(ctx, f.path, { t: 'bitmap', id: s.id, m: bm, repeat: s.repeat, smooth: s.smooth }, m, cx, obj.$lib);
      } else {
        const t = obj.$ratio / 65535;
        const gm = s.m0.map((v, j) => v + (s.m1[j] - v) * t);
        const stops = s.stops.map(([r0, c0, r1, c1]) => [Math.round(r0 + (r1 - r0) * t), P.lerpC(c0, c1)]);
        this.fillPath(ctx, f.path, { t: s.t, m: gm, stops, focal: s.focal0 }, m, cx, obj.$lib);
      }
    }
    for (const l of P.lines) {
      const s = l.style;
      if (!s) continue;
      this.strokePath(ctx, l.path, { w: P.lerp(s.w0, s.w1), c: s.c0 ? P.lerpC(s.c0, s.c1) : [0, 0, 0, 255] }, m, cx);
    }
  }

  // ---- static text ------------------------------------------------------------------------
  drawStaticText(ctx, obj, m, cx) {
    const ch = obj.$char;
    const tm = mul(m, ch.m);
    for (const rec of ch.recs) {
      const font = obj.$lib.char(rec.font);
      if (!font) continue;
      const scale = rec.h / (font.em / 20);
      ctx.fillStyle = cssColor(cxApplyRGBA(cx, rec.color || [0, 0, 0, 255]));
      let x = rec.x;
      for (const [gi, adv] of rec.g) {
        const d = font.glyphs[gi];
        if (d) {
          const p = obj.$lib.path(`font${rec.font}:${gi}`, d);
          this.setTransform(ctx, mul(tm, [scale, 0, 0, scale, x, rec.y]));
          ctx.fill(p, 'evenodd');
        }
        x += adv;
      }
    }
  }

  // ---- filters ----------------------------------------------------------------------------
  // Flash drew an object that has filters as a cached bitmap: its content rendered once,
  // filtered, and reused until the content or its scale changed; drawn at a whole-pixel
  // position, with the object's own colour transform applied to the filtered result.  So
  // does this.  The filtering is Flash's own arithmetic on the GPU (filters.js); without
  // WebGL2 it falls back to an SVG filter chain that approximates it (defineFilter).
  // Filter on the GPU if it is there and pays its way: if its runs average more than 5ms
  // (uploads and readbacks can stall on some systems), use the SVG filters from then on.
  glRun(src, w, h, filters, octx) {
    if (!this.gl) return false;
    const t0 = performance.now();
    const ok = this.gl.run(src, w, h, filters, this.scale, octx);
    this.glTime += performance.now() - t0;
    if (!ok || (++this.glRuns >= 60 && this.glTime / this.glRuns > 5 && !this.forceGL)) {
      console.info('[render] filters: using SVG filters from now on');
      this.gl = null;
      this.fcache.clear();
      this.fcachePixels = 0;
    }
    return ok;
  }

  // The filters that do something, or null.  A blur of at most one pixel, or with no
  // passes, changes nothing and is skipped, as Flash skipped it; so is an identity colour
  // matrix.  (Tweened blurs pass through 0 and 1 all the time.)
  potentFilters(filters) {
    if (!filters || !filters.length) return null;
    let fl = this.potent.get(filters);
    if (fl === undefined) {
      fl = filters.filter((f) => {
        if (f.type === 'blur') return (f.passes || 0) > 0 && (f.blurX > 1 || f.blurY > 1);
        if (f.type === 'colorMatrix') return !f.matrix.every((v, i) => v === ([0, 6, 12, 18].includes(i) ? 1 : 0));
        return true;
      });
      if (!fl.length) fl = null;
      this.potent.set(filters, fl);
    }
    return fl;
  }

  drawFiltered(ctx, obj, m, cx, filters) {
    const lb = obj.$localBounds();
    if (!lb) return;
    const pad = filterPadding(filters, this.scale);
    const db = boundsOf(m, lb);
    let x0 = Math.floor(db[0]) - pad, y0 = Math.floor(db[1]) - pad;
    let x1 = Math.ceil(db[2]) + pad, y1 = Math.ceil(db[3]) + pad;
    let clamp = '';
    if ((x1 - x0) * (y1 - y0) > 4e6) {
      // Too big to keep whole (a filtered terrain, say): keep only what is on the canvas,
      // and draw it again when it moves.
      x0 = Math.max(x0, -pad); y0 = Math.max(y0, -pad);
      x1 = Math.min(x1, ctx.canvas.width + pad); y1 = Math.min(y1, ctx.canvas.height + pad);
      clamp = `${x0},${y0},${x1},${y1},${m[4]},${m[5]}`;
    }
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    if (w * h > 16e6) return this.drawContent(ctx, obj, m, cx);

    const key = `${m[0]},${m[1]},${m[2]},${m[3]}|${clamp}|${JSON.stringify(filters)}|${this.team || ''}|${this.contentSig(obj)}`;
    let e = this.fcache.get(obj);
    if (!e || e.key !== key) {
      if (e) this.fcachePixels -= e.canvas.width * e.canvas.height;
      const src = this.offscreen(w, h);
      const sctx = src.getContext('2d');
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalAlpha = 1;
      sctx.filter = 'none';
      sctx.clearRect(0, 0, w, h);
      this.drawContent(sctx, obj, mul([1, 0, 0, 1, -x0, -y0], m), null);
      const out = e && e.canvas.width === w && e.canvas.height === h ? e.canvas : document.createElement('canvas');
      out.width = w;
      out.height = h;
      const octx = out.getContext('2d');
      // Blurs, glows and shadows go to the GPU, where their shape is Flash's exactly; a
      // colour matrix alone is exact as an SVG filter too, and cheaper there.
      const blurs = filters.some((f) => f.type !== 'colorMatrix');
      if (blurs && this.gl === undefined) this.gl = GLFilters.create(this.forceGL);
      if (!blurs || !this.glRun(src, w, h, filters, octx)) {
        octx.clearRect(0, 0, w, h);
        octx.filter = this.filterUrl(filters);
        octx.drawImage(src, 0, 0, w, h, 0, 0, w, h);
        octx.filter = 'none';
      }
      this.scratch.push(src);
      e = { key, canvas: out, x0, y0, tx: m[4], ty: m[5], version: (e ? e.version : 0) + 1, id: this.fcacheIds++ };
      this.fcachePixels += w * h;
    }
    this.fcache.delete(obj);                       // most recently used last
    this.fcache.set(obj, e);
    while (this.fcachePixels > 24e6 && this.fcache.size > 1) {
      const [old, oe] = this.fcache.entries().next().value;
      this.fcache.delete(old);
      this.fcachePixels -= oe.canvas.width * oe.canvas.height;
    }

    const dx = e.x0 + Math.round(m[4] - e.tx);
    const dy = e.y0 + Math.round(m[5] - e.ty);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    if (cxIsIdentity(cx)) {
      ctx.globalAlpha = 1;
      ctx.drawImage(e.canvas, dx, dy);
    } else if (cxAlphaOnly(cx) && cx[3] <= 256 && cx[7] === 0) {
      ctx.globalAlpha = Math.max(0, cx[3] / 256);
      ctx.drawImage(e.canvas, dx, dy);
    } else {
      ctx.globalAlpha = 1;
      ctx.drawImage(this.tinted(`filt${e.id}:${e.version}`, e.canvas, cx), dx, dy);
    }
    ctx.restore();
  }

  // Everything below obj that decides how it draws, as a string: a cached filtered image
  // stays valid for as long as this does not change.
  contentSig(obj) {
    const text = this.player.text;
    const parts = [];
    const walk = (o, top) => {
      parts.push(o.$id);
      if (o.$team) parts.push('t' + o.$team);
      if (!top) {
        parts.push(o.$visible ? 1 : 0, o.$m.join(','));
        if (o.$cx) parts.push(o.$cx.join(','));
        if (o.$filters) parts.push(JSON.stringify(o.$filters));
        if (o.$clipDepth) parts.push('k' + o.$clipDepth);
        if (o.$maskOf) parts.push('mo');
      }
      if (o.$maskClip) parts.push('m' + o.$maskClip.$id + ':' + o.$maskClip.$worldMatrix().join(','));
      if (o instanceof MovieClip) {
        parts.push('f' + o.$cur);
        if (o.$gfx) parts.push('g' + o.$gfx.$id + ':' + o.$gfx.ops.length);
      } else if (o instanceof MorphObj) {
        parts.push('r' + o.$ratio);
      } else if (o instanceof EditText) {
        text.bind(o);
        parts.push(o.$text, o.$html ? 1 : 0, o.$color.join(','), o.$scroll, o.$focus && text.caretOn ? 1 : 0);
      } else if (o instanceof BitmapObj) {
        parts.push('b' + o.$bmd.$id + ':' + o.$bmd.$version);
      }
      if (o.$children) for (const c of o.$children) walk(c, false);
    };
    walk(obj, true);
    return parts.join('|');
  }

  offscreen(w, h) {
    let c = this.scratch.pop();
    if (!c) c = document.createElement('canvas');
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, w);
      c.height = Math.max(c.height, h);
    }
    return c;
  }

  filterPad(filters) {
    let p = 0;
    for (const f of filters) {
      const b = Math.max(f.blurX || 0, f.blurY || 0) * Math.sqrt(Math.max(1, f.passes || 1));
      p = Math.max(p, b * 1.5 + (f.distance || 0));
    }
    return Math.ceil(p) + 2;
  }

  // One SVG <filter> per distinct filter list, the least recently used dropped beyond 128
  // (some filters are animated, with new parameters every frame).
  filterUrl(filters) {
    const key = this.scale.toFixed(3) + '|' + JSON.stringify(filters);
    let d = this.filterDefs.get(key);
    if (d) {
      this.filterDefs.delete(key);
    } else {
      d = { id: 'cacf' + this.filterIds++ };
      d.el = this.defineFilter(d.id, filters);
      if (this.filterDefs.size >= 128) {
        const [k, old] = this.filterDefs.entries().next().value;
        this.filterDefs.delete(k);
        old.el.remove();
      }
    }
    this.filterDefs.set(key, d);
    return `url(#${d.id})`;
  }

  defineFilter(id, filters) {
    if (!this.filterSvg) {
      this.filterSvg = document.createElementNS(SVGNS, 'svg');
      this.filterSvg.setAttribute('width', '0');
      this.filterSvg.setAttribute('height', '0');
      this.filterSvg.style.position = 'absolute';
      document.body.appendChild(this.filterSvg);
    }
    const fe = document.createElementNS(SVGNS, 'filter');
    fe.setAttribute('id', id);
    fe.setAttribute('x', '-50%');
    fe.setAttribute('y', '-50%');
    fe.setAttribute('width', '200%');
    fe.setAttribute('height', '200%');
    fe.setAttribute('color-interpolation-filters', 'sRGB');
    const s = this.scale;
    let src = 'SourceGraphic';
    let n = 0;
    const el = (tag, attrs) => {
      const e = document.createElementNS(SVGNS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      fe.appendChild(e);
      return e;
    };
    // Without the GPU path this approximates Flash's box blur with a Gaussian of the same
    // spread: a box of width w has sigma w/sqrt(12), and n passes compound to sigma*sqrt(n).
    // The glow arithmetic is Flash's (Ruffle's glow.wgsl).
    const sigma = (b, passes) => (Math.max(0, scaleBlur(b, s)) / Math.sqrt(12)) * Math.sqrt(Math.max(1, passes || 1));
    const node = (parent, tag, attrs) => {
      const e = document.createElementNS(SVGNS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      parent.appendChild(e);
      return e;
    };
    for (const f of filters) {
      const out = 'r' + (n++);
      if (f.type === 'blur') {
        el('feGaussianBlur', { in: src, stdDeviation: `${sigma(f.blurX, f.passes)} ${sigma(f.blurY, f.passes)}`, result: out });
      } else if (f.type === 'colorMatrix') {
        const mm = f.matrix.slice();
        for (const i of [4, 9, 14, 19]) mm[i] = mm[i] / 255;
        el('feColorMatrix', { in: src, type: 'matrix', values: mm.join(' '), result: out });
      } else if (f.type === 'glow' || f.type === 'dropShadow') {
        const [r, g, b, a] = f.color;
        const strength = f.strength === undefined ? 1 : f.strength;
        const dist = f.type === 'dropShadow' ? (f.distance || 0) * s : 0;
        const ang = f.type === 'dropShadow' ? f.angle || 0 : 0;
        // The alpha of the image so far, blurred, and moved for a shadow.
        el('feColorMatrix', { in: src, type: 'matrix', values: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', result: out + 'a' });
        el('feGaussianBlur', { in: out + 'a', stdDeviation: `${sigma(f.blurX, f.passes)} ${sigma(f.blurY, f.passes)}`, result: out + 'b' });
        el('feOffset', { in: out + 'b', dx: dist * Math.cos(ang), dy: dist * Math.sin(ang), result: out + 'o' });
        // Outer glows are strength x blur, inner ones strength x (1 - blur), clamped.
        node(el('feComponentTransfer', { in: out + 'o', result: out + 's' }), 'feFuncA',
          f.inner ? { type: 'linear', slope: -strength, intercept: strength } : { type: 'linear', slope: strength });
        el('feFlood', { 'flood-color': `rgb(${r},${g},${b})`, 'flood-opacity': String(a / 255), result: out + 'c' });
        el('feComposite', { in: out + 'c', in2: out + 's', operator: 'in', result: out + 'g' });
        const composite = f.composite !== 0;
        if (f.inner) {
          el('feComposite', { in: out + 'g', in2: src, operator: f.knockout || !composite ? 'in' : 'atop', result: out });
        } else if (f.knockout) {
          el('feComposite', { in: out + 'g', in2: src, operator: 'out', result: out });
        } else if (composite) {
          const mg = el('feMerge', { result: out });
          for (const inp of [out + 'g', src]) node(mg, 'feMergeNode', { in: inp });
        } else {
          el('feOffset', { in: out + 'g', dx: 0, dy: 0, result: out });     // the glow alone
        }
      } else {
        continue;                   // bevel/convolution/gradient filters: not in this game
      }
      src = out;
    }
    this.filterSvg.appendChild(fe);
    return fe;
  }
}
