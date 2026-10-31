// The custom map format (src/online/cacmap.js): every map the game has, as a cacmap and back,
// cell for cell; the editor's painting choosing the pieces the converter chose; and the checks
// refusing what is not a map.
//
//   node tools/verify/cacmap.mjs [story.json]     (story.json: the story's maps, { "1": "<map string>", ... })

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as C from '../../src/online/cacmap.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0;
const check = (ok, what) => { if (!ok) { failed++; console.log('FAIL ' + what); } };

// 1. the skirmish maps, through cacmap and back
const ids = JSON.parse(readFileSync(join(ROOT, 'data/maps/index.json'), 'utf8')).map((m) => m.id);
let same = 0, valid = 0;
for (const id of ids) {
  const entry = JSON.parse(readFileSync(join(ROOT, 'data/maps', id + '.json'), 'utf8'));
  const map = C.fromGameMap(entry);
  map.name = entry.name;
  const v = C.validate(JSON.parse(JSON.stringify(map)));
  if (v.ok) valid++; else console.log('  ' + id + ': ' + v.errors.join('; '));
  const back = C.toGameEntry(v.ok ? v.map : map, id);
  if (back.map === entry.map && JSON.stringify(back.solid) === JSON.stringify(entry.solid) && JSON.stringify(back.bases) === JSON.stringify(entry.bases.slice(0, C.LIMITS.bases))) same++;
}
console.log('skirmish maps: ' + same + '/' + ids.length + ' the same after the round trip, ' + valid + ' valid');
check(same === ids.length, 'skirmish round trip');

// 2. the editor's brush: a converted map repainted from its kinds alone gets the same pieces
let pieces = 0, total = 0;
for (const id of ids.slice(0, 12)) {
  const entry = JSON.parse(readFileSync(join(ROOT, 'data/maps', id + '.json'), 'utf8'));
  const map = C.fromGameMap(entry);
  const solid = C.solidCells(map);
  const kinds = { [C.OPEN]: [], [C.ROCK]: [], [C.POOL]: [], [C.CRYSTAL]: [] };
  for (let y = 1; y <= map.h; y++) for (let x = 1; x <= map.w; x++) {
    const i = (y - 1) * map.w + (x - 1);
    kinds[solid.has(i) ? C.ROCK : C.kindOf(C.tileAt(map, x, y))].push([x, y]);
  }
  const redo = C.fromGameMap(entry);
  redo.tiles = C.ASCII[0].repeat(map.w * map.h);
  redo.solid = [];
  for (const k of [C.ROCK, C.POOL, C.CRYSTAL]) C.paint(redo, kinds[k], k);
  for (let i = 0; i < map.tiles.length; i++) { total++; if (redo.tiles[i] === map.tiles[i]) pieces++; }
}
console.log('brush: ' + pieces + '/' + total + ' cells take the converter\'s piece (' + (100 * pieces / total).toFixed(2) + '%)');
check(pieces / total > 0.999, 'brush pieces');

// 3. the story's maps, as singleplayer maps
const storyFile = process.argv[2];
if (storyFile) {
  const story = JSON.parse(readFileSync(storyFile, 'utf8'));
  let ok = 0, n = 0;
  for (const [level, str] of Object.entries(story)) {
    n++;
    const map = C.fromGameMap({ name: 'Level ' + level, map: str }, 'story');
    // (something of the player's, on open ground)
    let spot = null;
    for (let y = 2; y < map.h && !spot; y++) for (let x = 2; x < map.w && !spot; x++) if (C.walkable(map, x, y)) spot = { x, y };
    map.story.units.push({ t: 'BA_good', x: spot.x, y: spot.y, f: 0.5, own: 'player', hp: 1 });
    const v = C.validate(JSON.parse(JSON.stringify(map)));
    if (v.ok && C.ASCII[v.map.w] + C.ASCII[v.map.h] + v.map.tiles === str) ok++;
    else console.log('  level ' + level + ': ' + (v.errors || []).join('; '));
  }
  console.log('story maps: ' + ok + '/' + n + ' valid and the same');
  check(ok === n, 'story maps');
}

// 4. what is not a map
const good = C.blank('skirmish', 20, 20);
good.name = 'Test';
good.bases = [{ x: 5, y: 5 }, { x: 15, y: 15 }];
check(C.validate(JSON.parse(JSON.stringify(good))).ok, 'a blank skirmish map is valid');
const bad = [
  ['a string', 'map'], ['an array', []], ['no version', Object.assign({}, good, { v: 2 })],
  ['a script in the name', Object.assign({}, good, { name: 'x'.repeat(40) })],
  ['an unknown tile', Object.assign({}, good, { tiles: 'ÿ' + good.tiles.slice(1) })],
  ['too big', Object.assign({}, good, { w: 500 })],
  ['a base off the map', Object.assign({}, good, { bases: [{ x: 0, y: 5 }, { x: 15, y: 15 }] })],
  ['a base in rock', Object.assign({}, good, { bases: [{ x: 1, y: 1 }, { x: 15, y: 15 }] })],
  ['one base', Object.assign({}, good, { bases: [{ x: 5, y: 5 }] })],
  ['an unknown palette', Object.assign({}, good, { palette: "mars'; DROP TABLE maps;--" })],
  ['a solid run past the end', Object.assign({}, good, { solid: [[399, 5]] })],
];
for (const [what, m] of bad) check(!C.validate(m).ok, 'refused: ' + what);
const extra = C.validate(Object.assign(JSON.parse(JSON.stringify(good)), { __proto__x: 1, script: 'alert(1)', constructor: 'x' }));
check(extra.ok && !('script' in extra.map) && !('__proto__x' in extra.map), 'unknown fields dropped');
const st = C.blank('story', 20, 20);
st.name = 'S';
st.story.units.push({ t: 'BA_good', x: 5, y: 5, own: 'player' }, { t: 'BD_evil', x: 15, y: 15, own: 'enemy', b: 'seek' });
st.story.items.push({ k: 'gift', x: 10, y: 10 }, { k: 'crate', x: 11, y: 10, u: 'UE_good' });
for (const [win, ok] of [[{ k: 'infiltrate', n: 1 }, true], [{ k: 'infiltrate', n: 0 }, false], [{ k: 'protect', n: 0, s: 120 }, true],
  [{ k: 'collect', k2: 'gift', c: 1 }, true], [{ k: 'collect', k2: 'gift', c: 2 }, false], [{ k: 'survive', s: 300 }, true], [{ k: 'eval' }, false]]) {
  st.story.win = win;
  check(C.validate(JSON.parse(JSON.stringify(st))).ok === ok, 'story win ' + JSON.stringify(win) + (ok ? ' valid' : ' refused'));
}
// 5. files: an unfinished draft opens again (repair), its terrain as it was, what the format
// cannot keep left out and said; what is not a map does not
const draft = C.blank('story', 20, 20);
check(!C.validate(JSON.parse(JSON.stringify(draft))).ok, 'an unfinished draft is not a finished map');
const back = C.repair(JSON.parse(JSON.stringify(draft)));
check(back && back.map.tiles === draft.tiles && JSON.stringify(back.map.solid) === JSON.stringify(draft.solid) && !back.dropped.length, 'an unfinished draft opens as it was');
draft.story.units.push({ t: 'BA_good', x: 5, y: 5, own: 'player' }, { t: 'XX', x: 1, y: 1, own: 'player' }, { t: 'UA_evil', x: 99, y: 1, own: 'enemy' });
draft.story.items.push({ k: 'pizza', x: 3, y: 3 }, { k: 'eval', x: 3, y: 3 });
draft.name = 'x'.repeat(50);
draft.script = 'alert(1)';
const fixed = C.repair(JSON.parse(JSON.stringify(draft)));
check(fixed.map.story.units.length === 1 && fixed.map.story.items.length === 1 && fixed.dropped.length === 1 && fixed.map.name.length === C.LIMITS.name && !('script' in fixed.map),
  'a draft\'s bad things left out, and said');
check(C.repair({ v: 1, kind: 'skirmish', w: 10, h: 10, tiles: 'x' }) === null && C.repair('map') === null && C.repair([]) === null && C.repair({ v: 2 }) === null, 'what is not a map does not open');
check(C.repair(JSON.parse(JSON.stringify(good))).map.name === 'Test', 'a finished map opens as validate keeps it');
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
