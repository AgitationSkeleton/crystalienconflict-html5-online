// Custom maps, "cacmap" (version 1): the format the map editor saves, the server keeps and the
// game plays -- data only, nothing in it is ever run.  Shared by the game (src/online/) and the
// server (server/src/maps.js), so that both check a map the same way: validate() keeps only
// what the format knows, in range, or says why not.
//
//   { v: 1, kind: 'skirmish' | 'story', name, desc, palette, music,
//     w, h,                     size in cells (8 to 128 each)
//     tiles,                    the story's tile ids, a character each (ASCII below), w*h of them
//     solid,                    cells drawn open that are rock all the same: runs [start, length]
//     bases: [{x, y}],          a skirmish's start places, 2 to 6 (as many players as it takes)
//     story: {                  a singleplayer map's
//       side: 'good' | 'evil', cash,
//       brief,                  the mission text shown at the start (up to 280 characters; none:
//                               the goal's own summary, summary())
//       units: [{t, x, y, f, own, hp, b, d, r}], things on the map at the start: type, cell,
//                               facing (0 to 1), whose ('player', 'enemy'), health (0.1 to 1),
//                               behaviour (an enemy's: 'still', 'roam', 'seek'), and a delay
//                               (frames before an enemy stirs); r, an enemy unit that comes back
//                               from the building that makes it, while that stands (the story's)
//       items: [{k, x, y, u}],  pickups: 'crate' (a unit in a box, u its type), 'cash', 'gift',
//                               'pizza'
//       reveal: [{x, y, r}],    shroud lifted at the start
//       win: {k, ...}           what wins it: 'all', 'buildings', 'hq', 'infiltrate' (n: the
//                               enemy building's place in units), 'protect' (n: the player's
//                               thing's place in units, s: seconds to hold out), 'collect'
//                               (k2: the kind of item, or 'any'; c: how many), 'survive' (s)
//     } }
//
// Cells are numbered from 1, as the game numbers them (x 1 to w, y 1 to h).

// The game's own tables: its characters for numbers (ascii2num), and which tile ids block.
export const ASCII = [" ", "!", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":", ";", "<", "=", ">", "?", "@", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "[", "]", "^", "_", "`", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "{", "|", "}", "~", "\u20ac", "\u0192", "\u201e", "\u2026", "\u2020", "\u2021", "\u02c6", "\u2030", "\u0160", "\u2039", "\u0152", "\u017d", "\u2018", "\u2019", "\u201c", "\u201d", "\u2022", "\u2013", "\u2014", "\u02dc", "\u2122", "\u0161", "\u203a", "\u0153", "\u009d", "\u017e", "\u0178", "\u00a1", "\u00a2", "\u00a3", "\u00a4", "\u00a5", "\u00a6", "\u00a7", "\u00a8", "\u00a9", "\u00aa", "\u00ab", "\u00ac", "\u00ad", "\u00ae", "\u00af", "\u00b0", "\u00b1", "\u00b2", "\u00b3", "\u00b4", "\u00b5", "\u00b6", "\u00b7", "\u00b8", "\u00b9", "\u00ba", "\u00bb", "\u00bc", "\u00bd", "\u00be", "\u00bf", "\u00c0", "\u00c1", "\u00c2", "\u00c3", "\u00c4", "\u00c5", "\u00c6", "\u00c7", "\u00c8", "\u00c9", "\u00ca", "\u00cb", "\u00cc", "\u00cd", "\u00ce", "\u00cf", "\u00d0", "\u00d1", "\u00d2", "\u00d3", "\u00d4", "\u00d5", "\u00d6", "\u00d7", "\u00d8", "\u00d9", "\u00da", "\u00db", "\u00dc", "\u00dd", "\u00de", "\u00df", "\u00e0", "\u00e1", "\u00e2", "\u00e3", "\u00e4", "\u00e5", "\u00e6", "\u00e7", "\u00e8", "\u00e9", "\u00ea", "\u00eb", "\u00ec", "\u00ed", "\u00ee", "\u00ef", "\u00f0", "\u00f1", "\u00f2", "\u00f3", "\u00f4", "\u00f5", "\u00f6", "\u00f7", "\u00f8", "\u00f9", "\u00fa", "\u00fb", "\u00fc", "\u00fd", "\u00fe", "\u00ff"];
export const BLOCKED = [0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 0];

export const VERSION = 1;
export const MIN_SIZE = 8;
export const MAX_SIZE = 128;
export const TILE_COUNT = 51;            // ids 0 to 50, the story's pieces
export const PALETTES = ['mars', 'snowy', 'hive', 'lb-mars', 'lb-castle', 'lb-pirate', 'lb-mars-fw', 'lb-castle-fw', 'lb-pirate-fw'];
export const MUSIC = [0, 1, 2, 3, 4];        // the game's four tracks; 0, one of them by chance
export const BEHAVIOURS = ['still', 'roam', 'seek'];
export const ITEMS = ['crate', 'cash', 'gift', 'pizza'];
export const WINS = ['all', 'buildings', 'hq', 'infiltrate', 'protect', 'collect', 'survive'];
// What a map may place: the story's buildings and units of both sides (not the superweapons'
// shots, the crates' insides as things of their own, or the pizza, which is an item).
export const BUILDINGS = ['BA', 'BB', 'BC', 'BD', 'BE', 'BF', 'BG', 'BH'].flatMap((c) => [c + '_good', c + '_evil'])
  .concat(['BK_good', 'BK_evil', 'BL_good', 'BJ_evil']);
export const UNITS = ['UA', 'UB', 'UC', 'UD', 'UE', 'UF', 'UG', 'UH', 'UP'].flatMap((c) => [c + '_good', c + '_evil'])
  .concat(['UR_good', 'UQ_evil', 'UM_evil', 'UN_evil']);
export const LIMITS = { name: 32, desc: 280, brief: 280, units: 400, items: 100, reveal: 60, bases: 6, cash: 1000000, delay: 100000, seconds: 3600, collect: 100, bytes: 65536 };

// The kinds of cell the editor paints, and the story's pieces for each (tools/convert_maps.py
// found them: which piece a blocked cell takes by which of its eight neighbours are blocked).
export const OPEN = 0, ROCK = 1, POOL = 2, CRYSTAL = 3;
export const CRYSTAL_TILE = 47;
export const ROCK_TILES = { interior: 9, N: 1, E: 2, S: 3, W: 4, NE: 5, SE: 6, SW: 7, NW: 8, in_NE: 11, in_SE: 12, in_SW: 13, in_NW: 14,
  in_SE_NW: 15, in_NE_SW: 16, tip_S: 17, tip_N: 22, tip_E: 23, tip_W: 19, alone: 20 };
export const POOL_TILES = { interior: 37, N: 29, E: 30, S: 31, W: 32, NE: 33, SE: 34, SW: 35, NW: 36, in_NE: 39, in_SE: 40, in_SW: 41, in_NW: 42,
  in_SE_NW: 44, in_NE_SW: 43, tip_S: 29, tip_N: 31, tip_E: 32, tip_W: 30, alone: 29 };
const AUTO = new Set([...Object.values(ROCK_TILES), ...Object.values(POOL_TILES), CRYSTAL_TILE, 0]);

// ---- cells -------------------------------------------------------------------------------------
export function tileAt(map, x, y) { return ASCII.indexOf(map.tiles[(y - 1) * map.w + (x - 1)]); }

// What a tile id is, for painting and for checks: crystals, water (the acid pools), rock, open.
export function kindOf(id) {
  if (id === CRYSTAL_TILE) return CRYSTAL;
  if (id >= 29 && id <= 44) return POOL;
  return BLOCKED[id] ? ROCK : OPEN;
}

// Whether a cell can be walked: open ground or crystals, and not a solid run's.
export function walkable(map, x, y, solidSet) {
  if (x < 1 || y < 1 || x > map.w || y > map.h) return false;
  if (solidSet && solidSet.has((y - 1) * map.w + (x - 1))) return false;
  return !BLOCKED[tileAt(map, x, y)];
}

export function solidCells(map) {
  const s = new Set();
  for (const [at, n] of map.solid || []) for (let i = 0; i < n; i++) s.add(at + i);
  return s;
}

// The piece a blocked cell takes among blocked neighbours (`blocked(dx, dy)`), as the story's
// maps choose them.
export function pieceKey(blocked) {
  const n = blocked(0, -1), e = blocked(1, 0), s = blocked(0, 1), w = blocked(-1, 0);
  const ne = blocked(1, -1), se = blocked(1, 1), sw = blocked(-1, 1), nw = blocked(-1, -1);
  if (n && e && s && w) {
    const open = [['NE', ne], ['SE', se], ['SW', sw], ['NW', nw]].filter(([, v]) => !v).map(([k]) => k);
    if (!open.length) return 'interior';
    if (open.length === 2 && open.includes('SE') && open.includes('NW')) return 'in_SE_NW';
    if (open.length === 2 && open.includes('NE') && open.includes('SW')) return 'in_NE_SW';
    return 'in_' + open[0];
  }
  if (!n && e && s && w) return 'N';
  if (n && !e && s && w) return 'E';
  if (n && e && !s && w) return 'S';
  if (n && e && s && !w) return 'W';
  if (!n && !e && s && w) return 'NE';
  if (n && !e && !s && w) return 'SE';
  if (n && e && !s && !w) return 'SW';
  if (!n && e && s && !w) return 'NW';
  if (n && !e && !s && !w) return 'tip_N';
  if (s && !n && !e && !w) return 'tip_S';
  if (e && !n && !s && !w) return 'tip_E';
  if (w && !n && !s && !e) return 'tip_W';
  if (n && s) return !e ? 'E' : 'W';
  if (e && w) return !n ? 'N' : 'S';
  return 'alone';
}

// A kind painted on cells (an editor's brush): each is set, and the pieces of it and of the
// cells around it chosen again -- those the painter left to the game, not a piece put down by
// hand (a hand-picked tile keeps its place).  `cells` are [x, y] pairs; the map changes.
export function paint(map, cells, kind) {
  const chars = map.tiles.split('');
  const kinds = new Map();
  const solid = solidCells(map);
  const at = (x, y) => (y - 1) * map.w + (x - 1);
  const kindHere = (x, y) => {
    if (x < 1 || y < 1 || x > map.w || y > map.h) return ROCK;              // off the map: blocked
    const k = kinds.get(at(x, y));
    if (k !== undefined) return k;
    // (a flat top drawn open is rock all the same)
    return solid.has(at(x, y)) ? ROCK : kindOf(ASCII.indexOf(chars[at(x, y)]));
  };
  for (const [x, y] of cells) if (x >= 1 && y >= 1 && x <= map.w && y <= map.h) kinds.set(at(x, y), kind);
  const redo = new Set();
  for (const [x, y] of cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 1 || yy < 1 || xx > map.w || yy > map.h) continue;
    const i = at(xx, yy);
    if (kinds.has(i) || AUTO.has(ASCII.indexOf(chars[i]))) redo.add(i);
  }
  for (const i of redo) {
    const x = (i % map.w) + 1, y = Math.floor(i / map.w) + 1;
    const k = kindHere(x, y);
    solid.delete(i);
    if (k === OPEN) chars[i] = ASCII[0];
    else if (k === CRYSTAL) chars[i] = ASCII[CRYSTAL_TILE];
    else {
      const blocked = (dx, dy) => { const kk = kindHere(x + dx, y + dy); return kk === ROCK || kk === POOL; };
      const key = pieceKey(blocked);
      const table = k === POOL ? POOL_TILES : ROCK_TILES;
      const id = table[key] !== undefined ? table[key] : table.interior;
      chars[i] = ASCII[id];
      // (a rock mass's flat top is a piece drawn open: it is rock all the same)
      if (k === ROCK && id === ROCK_TILES.interior) solid.add(i);
    }
  }
  map.tiles = chars.join('');
  map.solid = runs(solid);
  return map;
}

// A tile put down by hand, as it is (the exact layer: a story map cell for cell).
export function setTile(map, x, y, id) {
  const i = (y - 1) * map.w + (x - 1);
  map.tiles = map.tiles.slice(0, i) + ASCII[id] + map.tiles.slice(i + 1);
  const solid = solidCells(map);
  solid.delete(i);
  map.solid = runs(solid);
  return map;
}

export function runs(set) {
  const out = [];
  for (const i of [...set].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === i) last[1]++;
    else out.push([i, 1]);
  }
  return out;
}

// A blank map: open ground, edged with rock.
export function blank(kind, w, h) {
  const map = { v: VERSION, kind, name: '', desc: '', palette: 'mars', music: 0, w, h, tiles: ASCII[0].repeat(w * h), solid: [], bases: [] };
  if (kind === 'story') map.story = { side: 'good', cash: 5000, units: [], items: [], reveal: [], win: { k: 'all' } };
  const edge = [];
  for (let x = 1; x <= w; x++) edge.push([x, 1], [x, h]);
  for (let y = 2; y < h; y++) edge.push([1, y], [w, y]);
  return paint(map, edge, ROCK);
}

// Resized, the map's top left corner kept where it is (or another anchor: ax, ay of 0, 0.5 or
// 1), the new cells open ground; things beyond the new edges are dropped.
export function resize(map, w, h, ax = 0, ay = 0) {
  const ox = Math.round((w - map.w) * ax), oy = Math.round((h - map.h) * ay);
  const chars = [];
  const solid = solidCells(map);
  const kept = new Set();
  for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) {
    const sx = x - ox, sy = y - oy;
    if (sx >= 1 && sy >= 1 && sx <= map.w && sy <= map.h) {
      chars.push(map.tiles[(sy - 1) * map.w + (sx - 1)]);
      if (solid.has((sy - 1) * map.w + (sx - 1))) kept.add((y - 1) * w + (x - 1));
    } else chars.push(ASCII[0]);
  }
  const inside = (p) => p.x + ox >= 1 && p.y + oy >= 1 && p.x + ox <= w && p.y + oy <= h;
  const move = (list) => (list || []).filter(inside).map((p) => Object.assign({}, p, { x: p.x + ox, y: p.y + oy }));
  const out = Object.assign({}, map, { w, h, tiles: chars.join(''), solid: runs(kept), bases: move(map.bases) });
  if (map.story) out.story = Object.assign({}, map.story, { units: move(map.story.units), items: move(map.story.items), reveal: move(map.story.reveal) });
  return out;
}

// ---- the game's own maps, as cacmap ------------------------------------------------------------
// A skirmish map the game has (data/maps/<id>.json, or the story's own Eclipse).
export function fromGameMap(entry, kind = 'skirmish') {
  const w = ASCII.indexOf(entry.map[0]), h = ASCII.indexOf(entry.map[1]);
  const map = { v: VERSION, kind, name: entry.name || '', desc: '', palette: 'mars', music: 0, w, h, tiles: entry.map.slice(2, 2 + w * h),
    solid: (entry.solid || []).map((r) => r.slice()), bases: (entry.bases || []).slice(0, LIMITS.bases).map((b) => ({ x: b.x, y: b.y })) };
  if (kind === 'story') map.story = { side: 'good', cash: 5000, units: [], items: [], reveal: [], win: { k: 'all' } };
  return map;
}

// The map as the game plays it: an entry of Online.maps, encoded as the story's are.
export function toGameEntry(map, id) {
  return { id, name: map.name, source: 'custom', cols: map.w, rows: map.h, map: ASCII[map.w] + ASCII[map.h] + map.tiles,
    bases: (map.bases || []).map((b) => ({ x: b.x, y: b.y })), players: (map.bases || []).length, solid: (map.solid || []).map((r) => r.slice()),
    music: map.music || 0 };
}

// ---- checking --------------------------------------------------------------------------------
// The map as the format has it -- only its own fields, each checked -- or why it is not one.
// Anything it does not know is dropped; anything out of range, or of the wrong kind, fails it.
export function validate(input) {
  const errors = [];
  const fail = (e) => { errors.push(e); return { ok: false, errors }; };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('not a map');
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const str = (v, max) => typeof v === 'string' && v.length <= max;
  if (input.v !== VERSION) return fail('unknown version');
  if (input.kind !== 'skirmish' && input.kind !== 'story') return fail('kind');
  if (!str(input.name, LIMITS.name) || !input.name.trim()) errors.push('a name, of up to ' + LIMITS.name + ' characters');
  if (input.desc !== undefined && !str(input.desc, LIMITS.desc)) errors.push('a description of up to ' + LIMITS.desc + ' characters');
  if (!PALETTES.includes(input.palette)) errors.push('palette');
  if (!int(input.w, MIN_SIZE, MAX_SIZE) || !int(input.h, MIN_SIZE, MAX_SIZE)) return fail('size: ' + MIN_SIZE + ' to ' + MAX_SIZE + ' cells each way');
  const w = input.w, h = input.h;
  if (typeof input.tiles !== 'string' || input.tiles.length !== w * h) return fail('tiles');
  for (const ch of input.tiles) { const id = ASCII.indexOf(ch); if (id < 0 || id >= TILE_COUNT) return fail('tiles'); }
  const solid = [];
  if (!Array.isArray(input.solid) || input.solid.length > w * h) return fail('solid');
  for (const r of input.solid) {
    if (!Array.isArray(r) || r.length !== 2 || !int(r[0], 0, w * h - 1) || !int(r[1], 1, w * h - r[0])) return fail('solid');
    solid.push([r[0], r[1]]);
  }
  const cell = (p) => p && typeof p === 'object' && int(p.x, 1, w) && int(p.y, 1, h);
  const map = { v: VERSION, kind: input.kind, name: String(input.name || '').trim(), desc: String(input.desc || ''), palette: input.palette,
    // (a track the game does not have -- the editor once offered six -- is its own choice)
    music: MUSIC.includes(input.music) ? input.music : 0,
    w, h, tiles: input.tiles, solid, bases: [] };
  const ss = solidCells(map);
  const open = (x, y) => walkable(map, x, y, ss);
  if (!Array.isArray(input.bases)) return fail('bases');
  for (const b of input.bases.slice(0, LIMITS.bases + 1)) {
    if (!cell(b)) return fail('bases');
    map.bases.push({ x: b.x, y: b.y });
  }
  if (input.kind === 'skirmish') {
    if (map.bases.length < 2 || map.bases.length > LIMITS.bases) errors.push('2 to ' + LIMITS.bases + ' bases');
    map.bases.forEach((b, i) => { if (!open(b.x, b.y)) errors.push('base ' + (i + 1) + ' is on rock or water'); });
    if (map.bases.length >= 2 && !errors.length) {
      const reach = reachable(map, map.bases[0], ss);
      map.bases.forEach((b, i) => { if (i && !reach.has((b.y - 1) * w + (b.x - 1))) errors.push('base ' + (i + 1) + ' cannot reach base 1 on the ground'); });
    }
  } else {
    const s = input.story;
    if (!s || typeof s !== 'object') return fail('story');
    if (s.side !== 'good' && s.side !== 'evil') return fail('side');
    if (!int(s.cash, 0, LIMITS.cash)) errors.push('starting cash');
    const story = { side: s.side, cash: s.cash, units: [], items: [], reveal: [], win: { k: 'all' } };
    if (s.brief !== undefined && (typeof s.brief !== 'string' || s.brief.length > LIMITS.brief)) errors.push('mission text of up to ' + LIMITS.brief + ' characters');
    else if (s.brief && s.brief.trim()) story.brief = s.brief.trim();
    if (!Array.isArray(s.units) || s.units.length > LIMITS.units) return fail('up to ' + LIMITS.units + ' things');
    for (const u of s.units) {
      if (!cell(u) || !(BUILDINGS.includes(u.t) || UNITS.includes(u.t))) return fail('a thing');
      if (u.own !== 'player' && u.own !== 'enemy') return fail('whose');
      const one = { t: u.t, x: u.x, y: u.y, f: num(u.f, 0, 1) ? u.f : 0.5, own: u.own, hp: num(u.hp, 0.1, 1) ? u.hp : 1 };
      if (u.own === 'enemy') {
        one.b = BEHAVIOURS.includes(u.b) ? u.b : 'still';
        one.d = int(u.d, 0, LIMITS.delay) ? u.d : 0;
        if (u.r === true && u.t[0] === 'U') one.r = true;
      }
      story.units.push(one);
    }
    if (!Array.isArray(s.items) || s.items.length > LIMITS.items) return fail('up to ' + LIMITS.items + ' items');
    for (const it of s.items) {
      if (!cell(it) || !ITEMS.includes(it.k)) return fail('an item');
      const one = { k: it.k, x: it.x, y: it.y };
      if (it.k === 'crate') { if (!UNITS.includes(it.u)) return fail('a crate\'s unit'); one.u = it.u; }
      story.items.push(one);
    }
    if (!Array.isArray(s.reveal) || s.reveal.length > LIMITS.reveal) return fail('reveal');
    for (const r of s.reveal) { if (!cell(r) || !int(r.r, 1, 20)) return fail('reveal'); story.reveal.push({ x: r.x, y: r.y, r: r.r }); }
    const wn = s.win;
    if (!wn || !WINS.includes(wn.k)) return fail('win');
    story.win = { k: wn.k };
    if (wn.k === 'infiltrate' || wn.k === 'protect') {
      if (!int(wn.n, 0, story.units.length - 1)) errors.push('what to ' + wn.k);
      else {
        const target = story.units[wn.n];
        if (wn.k === 'infiltrate' && !(target.own === 'enemy' && target.t[0] === 'B')) errors.push('infiltrate an enemy building');
        if (wn.k === 'protect' && target.own !== 'player') errors.push('protect one of the player\'s');
        story.win.n = wn.n;
      }
      if (wn.k === 'protect') story.win.s = int(wn.s, 0, LIMITS.seconds) ? wn.s : 0;
    }
    if (wn.k === 'collect') {
      story.win.k2 = ITEMS.includes(wn.k2) ? wn.k2 : 'any';
      const have = story.items.filter((it) => story.win.k2 === 'any' || it.k === story.win.k2).length;
      if (!int(wn.c, 1, LIMITS.collect) || wn.c > have) errors.push('collect: as many as there are on the map at most');
      else story.win.c = wn.c;
    }
    if (wn.k === 'survive') { if (!int(wn.s, 10, LIMITS.seconds)) errors.push('survive: 10 to ' + LIMITS.seconds + ' seconds'); else story.win.s = wn.s; }
    const hq = story.units.filter((u) => u.own === 'player' && (u.t.slice(0, 2) === 'BA' || u.t.slice(0, 2) === 'UD'));
    if (!story.units.some((u) => u.own === 'player')) errors.push('something of the player\'s to start with');
    if (!hq.length && story.cash < 500) errors.push('a headquarters or a miner, or cash to start with');
    for (const u of story.units) if (u.t[0] === 'U' && !open(u.x, u.y) && !(UNITS.includes(u.t) && /^U[CGHP]/.test(u.t))) { errors.push('a unit on rock or water at ' + u.x + ',' + u.y); break; }
    map.story = story;
  }
  if (errors.length) return { ok: false, errors };
  if (JSON.stringify(map).length > LIMITS.bytes) return { ok: false, errors: ['too big'] };
  return { ok: true, errors: [], map };
}

// A map from a file, to go on editing: a finished one as validate() keeps it; an unfinished one
// (a draft saved before it had a name, its bases or its things -- what validate() refuses) as far
// as the format allows, what it cannot keep left out and said: { map, dropped } (dropped: what was
// left out, for the player), or null when it is not a map at all (its size, its tiles).  Data
// only, as validate()'s: nothing of the file's but what the format knows.
export function repair(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.v !== VERSION) return null;
  const v = validate(JSON.parse(JSON.stringify(input)));
  if (v.ok) return { map: v.map, dropped: [] };
  const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
  const num = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
  const kind = input.kind === 'story' ? 'story' : 'skirmish';
  if (!int(input.w, MIN_SIZE, MAX_SIZE) || !int(input.h, MIN_SIZE, MAX_SIZE)) return null;
  const w = input.w, h = input.h;
  if (typeof input.tiles !== 'string' || input.tiles.length !== w * h) return null;
  for (const ch of input.tiles) { const id = ASCII.indexOf(ch); if (id < 0 || id >= TILE_COUNT) return null; }
  const dropped = [];
  const map = blank(kind, w, h);
  map.tiles = input.tiles;
  map.solid = [];
  map.name = typeof input.name === 'string' ? input.name.slice(0, LIMITS.name) : '';
  map.desc = typeof input.desc === 'string' ? input.desc.slice(0, LIMITS.desc) : '';
  if (PALETTES.includes(input.palette)) map.palette = input.palette;
  if (MUSIC.includes(input.music)) map.music = input.music;
  for (const r of Array.isArray(input.solid) ? input.solid : []) {
    if (Array.isArray(r) && r.length === 2 && int(r[0], 0, w * h - 1) && int(r[1], 1, w * h - r[0])) map.solid.push([r[0], r[1]]);
    else { dropped.push('a bad run of rock'); break; }
  }
  const cell = (p) => p && typeof p === 'object' && int(p.x, 1, w) && int(p.y, 1, h);
  const all = Array.isArray(input.bases) ? input.bases : [];
  for (const b of all) if (cell(b) && map.bases.length < LIMITS.bases) map.bases.push({ x: b.x, y: b.y });
  if (map.bases.length < all.length) dropped.push((all.length - map.bases.length) + ' base(s)');
  if (kind === 'story') {
    const s = input.story && typeof input.story === 'object' ? input.story : {};
    const st = map.story;
    if (s.side === 'good' || s.side === 'evil') st.side = s.side;
    if (int(s.cash, 0, LIMITS.cash)) st.cash = s.cash;
    if (typeof s.brief === 'string' && s.brief.trim()) st.brief = s.brief.trim().slice(0, LIMITS.brief);
    let lost = 0;
    for (const u of Array.isArray(s.units) ? s.units : []) {
      if (!cell(u) || !(BUILDINGS.includes(u.t) || UNITS.includes(u.t)) || (u.own !== 'player' && u.own !== 'enemy') || st.units.length >= LIMITS.units) { lost++; continue; }
      const one = { t: u.t, x: u.x, y: u.y, f: num(u.f, 0, 1) ? u.f : 0.5, own: u.own, hp: num(u.hp, 0.1, 1) ? u.hp : 1 };
      if (u.own === 'enemy') { one.b = BEHAVIOURS.includes(u.b) ? u.b : 'still'; one.d = int(u.d, 0, LIMITS.delay) ? u.d : 0; if (u.r === true && u.t[0] === 'U') one.r = true; }
      st.units.push(one);
    }
    for (const it of Array.isArray(s.items) ? s.items : []) {
      if (!cell(it) || !ITEMS.includes(it.k) || (it.k === 'crate' && !UNITS.includes(it.u)) || st.items.length >= LIMITS.items) { lost++; continue; }
      st.items.push(it.k === 'crate' ? { k: it.k, x: it.x, y: it.y, u: it.u } : { k: it.k, x: it.x, y: it.y });
    }
    for (const r of Array.isArray(s.reveal) ? s.reveal : []) {
      if (!cell(r) || !int(r.r, 1, 20) || st.reveal.length >= LIMITS.reveal) { lost++; continue; }
      st.reveal.push({ x: r.x, y: r.y, r: r.r });
    }
    if (lost) dropped.push(lost + ' unit(s), item(s) or uncovered patch(es)');
    const wn = s.win && typeof s.win === 'object' ? s.win : {};
    if (WINS.includes(wn.k)) {
      st.win = { k: wn.k };
      if (int(wn.n, 0, Math.max(0, st.units.length - 1))) st.win.n = wn.n;
      if (int(wn.s, 0, LIMITS.seconds)) st.win.s = wn.s;
      if (wn.k === 'collect') { st.win.k2 = ITEMS.includes(wn.k2) ? wn.k2 : 'any'; if (int(wn.c, 1, LIMITS.collect)) st.win.c = wn.c; }
    }
  }
  return { map, dropped };
}

// What a singleplayer map's goal asks, in a sentence: its mission text when its maker wrote none.
// nameOf(type, side): what the game calls a unit or building ("Mothership"), with its side's name
// ("Alien Mothership") when side.
export function summary(story, nameOf) {
  const w = (story && story.win) || { k: 'all' };
  const t = story && story.units ? story.units[w.n] : undefined;
  const time = (s) => (s % 60 ? (s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : s + ' seconds')
    : s === 60 ? 'a minute' : s / 60 + ' minutes');
  switch (w.k) {
    case 'buildings': return 'Destroy every enemy building.';
    case 'hq': return 'Destroy the enemy headquarters.';
    case 'infiltrate': return 'Infiltrate the enemy ' + (t ? nameOf(t.t, false) : 'building') + '.';
    case 'protect': return 'Protect the ' + (t ? nameOf(t.t, true) : 'base') + (w.s ? ' for ' + time(w.s) : ' until the enemy is beaten') + '.';
    case 'collect': {
      const n = w.c || 1;
      const what = { crate: ['crate', 'crates'], cash: ['cash crate', 'cash crates'], gift: ['present', 'presents'], pizza: ['pizza', 'pizzas'] }[w.k2] || ['item', 'items'];
      return 'Pick up ' + (n === 1 ? 'a ' + what[0] : n + ' ' + what[1]) + '.';
    }
    case 'survive': return 'Survive for ' + time(w.s || 300) + '.';
    default: return 'Destroy every enemy unit and building.';
  }
}

// The cells a ground unit at `from` can walk to (eight ways), as indices.
export function reachable(map, from, solidSet) {
  const seen = new Set();
  const todo = [[from.x, from.y]];
  while (todo.length) {
    const [x, y] = todo.pop();
    const i = (y - 1) * map.w + (x - 1);
    if (seen.has(i) || !walkable(map, x, y, solidSet)) continue;
    seen.add(i);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) todo.push([x + dx, y + dy]);
  }
  return seen;
}

// Advice for the editor, not reasons to refuse: each base's crystals within reach, and so on.
export function advice(map) {
  const out = [];
  const ss = solidCells(map);
  const crystals = [];
  for (let i = 0; i < map.tiles.length; i++) if (ASCII.indexOf(map.tiles[i]) === CRYSTAL_TILE) crystals.push(i);
  if (!crystals.length) out.push('There are no crystals: nobody can mine.');
  const starts = map.kind === 'skirmish' ? map.bases : (map.story ? map.story.units.filter((u) => u.own === 'player').slice(0, 1) : []);
  starts.forEach((b, n) => {
    const reach = reachable(map, b, ss);
    const near = crystals.some((i) => { const x = (i % map.w) + 1, y = Math.floor(i / map.w) + 1; return Math.max(Math.abs(x - b.x), Math.abs(y - b.y)) <= 12 && reach.has(i); });
    if (crystals.length && !near) out.push((map.kind === 'skirmish' ? 'Base ' + (n + 1) : 'The player') + ' has no crystals within 12 cells.');
  });
  return out;
}

// ---- pictures ------------------------------------------------------------------------------------
// The map as the radar shows it, two pixels a cell across and one down (the game's cells are
// twice as wide as tall), in a palette's colours: [width, height, RGBA bytes].  For the editor's
// list, the browser and the server's Discord preview alike.
export const PREVIEW_COLOURS = {
  mars: { ground: [196, 93, 46], rock: [96, 52, 30], pool: [126, 196, 40], crystal: [120, 230, 90] },
  snowy: { ground: [222, 232, 240], rock: [120, 130, 140], pool: [150, 200, 240], crystal: [90, 220, 255] },
  hive: { ground: [74, 195, 54], rock: [30, 90, 30], pool: [190, 255, 60], crystal: [250, 240, 120] },
};
export function previewPixels(map, scale = 2) {
  const c = PREVIEW_COLOURS[map.palette] || (/castle|pirate/.test(map.palette) ? { ground: [88, 160, 70], rock: [70, 80, 70], pool: [60, 120, 200], crystal: [120, 230, 90] }
    : PREVIEW_COLOURS[/hive/.test(map.palette) ? 'hive' : 'mars']);
  const pw = map.w * 2 * scale, ph = map.h * scale;
  const px = new Uint8ClampedArray(pw * ph * 4);
  const ss = solidCells(map);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const id = ASCII.indexOf(map.tiles[y * map.w + x]);
    const k = ss.has(y * map.w + x) ? ROCK : kindOf(id);
    const col = k === ROCK ? c.rock : k === POOL ? c.pool : k === CRYSTAL ? c.crystal : c.ground;
    for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < 2 * scale; xx++) {
      const o = ((y * scale + yy) * pw + x * 2 * scale + xx) * 4;
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
    }
  }
  const dot = (x, y, col, r) => {
    for (let yy = -r; yy <= r; yy++) for (let xx = -2 * r; xx <= 2 * r; xx++) {
      const X = (x - 0.5) * 2 * scale + xx, Y = (y - 0.5) * scale + yy;
      if (X < 0 || Y < 0 || X >= pw || Y >= ph) continue;
      const o = (Math.floor(Y) * pw + Math.floor(X)) * 4;
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
    }
  };
  const BASE = [[255, 140, 0], [60, 120, 255], [230, 40, 40], [160, 60, 230], [40, 200, 220], [250, 220, 40]];
  (map.bases || []).forEach((b, i) => dot(b.x, b.y, BASE[i % BASE.length], scale + 1));
  if (map.story) {
    for (const u of map.story.units) dot(u.x, u.y, u.own === 'player' ? [255, 255, 255] : [20, 20, 20], Math.max(1, scale - 1));
    for (const it of map.story.items) dot(it.x, it.y, [255, 230, 0], Math.max(1, scale - 1));
  }
  return [pw, ph, px];
}
