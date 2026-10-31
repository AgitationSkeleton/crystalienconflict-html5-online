// The game's own art for the map editor (custom.js): the ground, the terrain pieces and crystals,
// the units, buildings and pickups -- each drawn once from the game's library clips, set up as the
// game sets them up (Tile, Unit and Building in src/scripts/game.js), onto a canvas, in a
// palette's colours (the game's PALETTE_LOOKS and paletteTile).  Nothing here is drawn by hand.
//
// Positions are the game's: a cell is 96 by 48; a terrain piece's clip sits at its cell's top
// left, a unit's at its cell's middle, a building's at its cell's bottom right.

export const CELL_W = 96;
export const CELL_H = 48;
// (a custom map's pickups, as the game makes them: Level.setupCustom)
export const ITEM_TYPES = { crate: 'UI_good', cash: 'UI_evil', gift: 'UO_evil', pizza: 'UJ_good' };

export class MapArt {
  constructor(player) {
    this.player = player;
    this.cache = new Map();
    this.clip = null;
    this.baitIds = null;
  }

  get game() { return this.player.levels[1]; }

  // Whether the game's library is there to draw from (it is once the game has loaded).
  ready() {
    const g = this.game;
    return !!(g && g.attachMovie && g.BuildingStats && g.UnitStats && g.mapData && this.player.renderer);
  }

  holder() {
    if (!this.clip || this.clip.$removed) {
      this.clip = this.game.createEmptyMovieClip('$mapArt', 1048000);
      this.clip._visible = false;        // (never on the stage: only drawn from, here)
    }
    return this.clip;
  }

  // A clip drawn onto a canvas just big enough for what shows of it, and where its origin is on
  // that canvas.  (Cropped to what is drawn: hidden health bars and titles count in its bounds.)
  snap(clip) {
    const r = this.player.renderer;
    const b = clip.getBounds(clip);
    const x0 = Math.floor(b.xMin) - 2, y0 = Math.floor(b.yMin) - 2;
    const w = Math.max(1, Math.ceil(b.xMax) - x0 + 2), h = Math.max(1, Math.ceil(b.yMax) - y0 + 2);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    const scale = r.scale;
    r.scale = 1;
    try {
      r.draw(g, clip, [1, 0, 0, 1, -x0, -y0], null);
    } finally {
      r.scale = scale;
    }
    const d = g.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 4) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(c, -minX, -minY);
    return { c: out, ox: -x0 - minX, oy: -y0 - minY };
  }

  // A colour matrix over a canvas's pixels, as a ColorMatrixFilter does.
  tint(canvas, m) {
    if (!m) return canvas;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gr = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (!a) continue;
      d[i] = clamp(m[0] * r + m[1] * gr + m[2] * b + m[3] * a + m[4]);
      d[i + 1] = clamp(m[5] * r + m[6] * gr + m[7] * b + m[8] * a + m[9]);
      d[i + 2] = clamp(m[10] * r + m[11] * gr + m[12] * b + m[13] * a + m[14]);
      d[i + 3] = clamp(m[15] * r + m[16] * gr + m[17] * b + m[18] * a + m[19]);
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }

  cached(key, make) {
    if (!this.cache.has(key)) {
      let art = null;
      try {
        art = make();
      } catch (e) {
        art = null;          // (a clip the library lacks: the editor draws its own mark instead)
      }
      this.cache.set(key, art);
    }
    return this.cache.get(key);
  }

  // Which piece ids are crystals (drawn as the "bait" clip): the game's tile table's flag.
  isBait(id) {
    if (!this.baitIds) {
      this.baitIds = new Set();
      const tiles = this.game.mapData().tiles || [];
      for (let i = 0; i < tiles.length; i++) if (this.game.ascii2num(tiles[i]) & 0x10) this.baitIds.add(i);
    }
    return this.baitIds.has(id);
  }

  // The ground: the game's repeating 500-pixel picture of it, in the palette's colours.
  ground(palette) {
    return this.cached('ground:' + palette, () => {
      const bmp = this.player.builtins.flash.display.BitmapData.loadBitmap('#4349');
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d').drawImage(bmp.$canvas, 0, 0);
      const look = this.game.PALETTE_LOOKS[palette];
      return this.tint(c, look && look.ground);
    });
  }

  // A terrain piece (0 is the bare ground: nothing).
  tile(id, palette) {
    if (!id) return null;
    return this.cached('tile:' + id + ':' + palette, () => {
      const bait = this.isBait(id);
      const mc = this.holder().attachMovie(bait ? 'bait' : 'tile', 'tile', 1);
      mc.gotoAndStop(bait ? 1 : id);
      const art = this.snap(mc);
      mc.removeMovieClip();
      if (art) this.tint(art.c, this.game.paletteTile(palette, id, bait));
      return art;
    });
  }

  // A unit (or a pickup) facing f (0 to 1, as the game's angles), in a player's colour.
  unit(type, f, colour) {
    const frame = (Math.round((f || 0) * 16) % 16) + 1;
    return this.cached('unit:' + type + ':' + frame + ':' + (colour || ''), () => {
      const stats = new this.game.UnitStats(type);
      const mc = this.holder().createEmptyMovieClip('unit', 2);
      if (colour) mc.teamColour = colour;
      const s = mc.attachMovie('unit', 'unit', 1);
      s.gotoAndStop(type);
      s.unit._x = s.shadow._x = -s.unit.bank._width / 2;
      s.unit._y = s.shadow._y = -s.unit.bank._height / 2;
      s.unit.gotoAndStop('straight');
      s.unit.bank.gotoAndStop(frame);
      s.shadow.gotoAndStop(frame);
      // (a flyer above its shadow, as Unit.draw puts it)
      if (stats.altitude > 0) s.unit._y = -s.unit.bank._height / 2 - stats.altitude;
      for (const k of ['health', 'squad', 'pulse']) if (s[k]) s[k]._visible = false;
      if (s.unit.sparks) s.unit.sparks._visible = false;
      if (s.unit.beam) s.unit.beam._visible = false;
      const art = this.snap(mc);
      mc.removeMovieClip();
      return art;
    });
  }

  // A building, finished (its idle loop's first frame), on its side's base plate, in a player's
  // colour.  Also its footprint, in cells.
  building(type, colour, side) {
    return this.cached('building:' + type + ':' + (colour || '') + ':' + side, () => {
      const stats = new this.game.BuildingStats(type);
      const mc = this.holder().createEmptyMovieClip('building', 3);
      if (colour) mc.teamColour = colour;
      const plate = mc.attachMovie('baseplate', 'baseplate', 1);
      plate.gotoAndStop(side + (stats.width == 1 ? '_1' : '_2'));
      if (stats.height == 2) plate._y = -CELL_H / 2;
      plate._alpha = 50;
      const s = mc.attachMovie('building', 'building', 2);
      s.gotoAndStop(type);
      s.building._x = s.shadow._x = -s.building._width / 2;
      s.building._y = s.shadow._y = -s.building._height / 2;
      const done = (clip) => (clip.$labels && clip.$labels.loopstart) || clip._totalframes;
      s.building.gotoAndStop(done(s.building));
      s.shadow.gotoAndStop(Math.min(done(s.building), s.shadow._totalframes));
      s.shadow._alpha = 50;
      for (const k of ['health', 'title', 'repair']) if (s[k]) s[k]._visible = false;
      const art = this.snap(mc);
      mc.removeMovieClip();
      if (art) {
        art.w = stats.width;
        art.h = stats.height;
      }
      return art;
    });
  }
}
