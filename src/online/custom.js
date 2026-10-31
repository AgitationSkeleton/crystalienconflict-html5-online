// Custom Maps (the main menu's): two tabs, the Browser -- maps others have shared, to subscribe
// to, like and see the high scores of -- and the Editor, for the player's own.  The maps are
// cacmap documents (src/online/cacmap.js), kept on this device: the player's drafts and the
// maps they have subscribed to (IndexedDB, store()), the subscribed ones played in a skirmish,
// offline or hosted online, as the game's own are (register()).

import * as C from './cacmap.js';
import { isClean } from './profanity.js';
import { PALETTES } from './settings.js';

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}

// ---- kept on this device --------------------------------------------------------------------
// Two stores: 'drafts' (the player's, by a local id) and 'maps' (subscribed, by the server's
// id), each record { id, map, ... }.  Without IndexedDB (a private window), kept in memory.
const DB_NAME = 'cac-custom';
export const store = {
  db: null,
  memory: { drafts: new Map(), maps: new Map() },
  async open() {
    if (this.db !== null) return this.db;
    this.db = await new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { for (const s of ['drafts', 'maps']) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
    return this.db;
  },
  async all(name) {
    const db = await this.open();
    if (!db) return [...this.memory[name].values()];
    return new Promise((resolve) => {
      const req = db.transaction(name).objectStore(name).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },
  async put(name, record) {
    const db = await this.open();
    if (!db) { this.memory[name].set(record.id, record); return; }
    await new Promise((resolve) => { const t = db.transaction(name, 'readwrite'); t.objectStore(name).put(record); t.oncomplete = resolve; t.onerror = resolve; });
  },
  async remove(name, id) {
    const db = await this.open();
    if (!db) { this.memory[name].delete(id); return; }
    await new Promise((resolve) => { const t = db.transaction(name, 'readwrite'); t.objectStore(name).delete(id); t.oncomplete = resolve; t.onerror = resolve; });
  },
};

// A custom map made playable: an entry of the game's skirmish maps (Online.maps), which the
// lobby lists and a skirmish plays by its id.
export function register(player, id, map) {
  player.online.maps = player.online.maps || {};
  player.online.maps[id] = C.toGameEntry(map, id);
  return id;
}

const NAMES = { good: 'Astro', evil: 'Alien' };
const KIND_NAMES = { skirmish: 'Skirmish', story: 'Singleplayer' };
const ITEM_NAMES = { crate: 'Crate (a unit)', cash: 'Cash crate', gift: 'Present', pizza: 'Pizza' };
const BEHAVIOUR_NAMES = { still: 'Stands still', roam: 'Wanders', seek: 'Hunts the player' };
const WIN_NAMES = { all: 'Destroy everything', buildings: 'Destroy every building', hq: 'Destroy the headquarters', infiltrate: 'Infiltrate a building',
  protect: 'Protect something', collect: 'Pick up items', survive: 'Survive' };
const TOOLS = [
  ['select', 'Select', 'Pick a thing, base or item to change or move it (drag), Delete to remove it'],
  ['area', 'Area', 'Mark a rectangle: copy it (Ctrl+C), cut it (Ctrl+X), clear it (Delete); paste (Ctrl+V) where you click'],
  ['open', 'Ground', 'Open ground'], ['rock', 'Rock', 'Rock (impassable)'], ['pool', 'Water', 'Acid pools (impassable)'], ['crystal', 'Crystals', 'Crystals to mine'],
  ['tile', 'Exact tile', 'One of the story\'s own pieces, as it is (for copying a map cell for cell)'],
  ['base', 'Base', 'A player\'s start (skirmish: as many bases as players)'],
  ['thing', 'Unit/building', 'Something on the map at the start (singleplayer)'],
  ['item', 'Item', 'A pickup (singleplayer)'], ['reveal', 'Reveal', 'Ground uncovered at the start (singleplayer)'],
];
// How a terrain or tile brush lays its cells: freehand, a line, a rectangle, an ellipse (Shift: its
// outline only, as thick as the brush), or the whole patch of the same ground (fill).
const SHAPES = [['free', 'Brush'], ['line', 'Line'], ['rect', 'Square'], ['ellipse', 'Circle'], ['fill', 'Fill']];
const PAINTS = ['open', 'rock', 'pool', 'crystal', 'tile'];
const BASE_COLOURS = ['#ff8c00', '#3c78ff', '#e62828', '#a03ce6', '#28c8dc', '#fadc28'];
const KIND_COLOURS = { 0: null, 1: 'rock', 2: 'pool', 3: 'crystal' };

export class CustomMaps {
  constructor(ui) {
    this.ui = ui;
    this.tab = 'browse';
    this.draft = null;               // { id, map } being edited
    this.undo = [];
    this.redo = [];
    this.view = { cell: 16, x: 0, y: 0 };
    this.tool = 'rock';
    this.brush = 1;
    this.shape = 'free';
    this.area = null;                // the Area tool's rectangle: {x0, y0, x1, y1}
    this.clip = null;                // what was copied (copyArea)
    this.pasting = false;            // the next click pastes it
    this.tileId = 9;
    this.thingType = 'UA_evil';
    this.thingOwn = 'enemy';
    this.itemKind = 'crate';
    this.crateUnit = 'UE_good';
    this.revealR = 4;
    this.selected = null;            // { list: 'units' | 'items' | 'reveal' | 'bases', i }
    this.build();
  }

  get player() { return this.ui.player; }

  build() {
    this.tabs = el('div', { class: 'tabs', role: 'tablist' },
      this.tabBrowse = el('button', { class: 'tab', role: 'tab', onclick: () => this.show('browse') }, 'Browser'),
      this.tabEdit = el('button', { class: 'tab', role: 'tab', onclick: () => this.show('edit') }, 'Level editor'));
    this.browseBox = el('div', { class: 'custom-browse' });
    this.editBox = el('div', { class: 'custom-edit' });
    const s = el('section', { class: 'screen custom' },
      el('div', { class: 'titlebar' }, el('h1', { text: 'Custom Maps' }), el('div', { class: 'spacer' }), this.tabs),
      this.browseBox, this.editBox,
      el('div', { class: 'actions', style: 'width:min(1100px,100%)' },
        el('button', { class: 'btn', onclick: () => { this.ui.sound('INT_cursor_select'); this.ui.show('main'); } }, 'Back')));
    this.ui.screens.custom = s;
    this.ui.root.append(s);
    // The editor's keys, wherever the focus is on its screen (not while typing in a box).
    document.addEventListener('keydown', (e) => {
      if (!this.ui.screens.custom.classList.contains('active') || this.tab !== 'edit' || !this.draft || !this.canvas) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (this.key(e)) e.preventDefault();
    });
  }

  key(e) {
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), step = 40;
    if (ctrl && k === 'z' && !e.shiftKey) this.back(this.undo, this.redo);
    else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) this.back(this.redo, this.undo);
    else if (ctrl && k === 'c') this.copyArea(false);
    else if (ctrl && k === 'x') this.copyArea(true);
    else if (ctrl && k === 'v') this.startPaste();
    else if (k === 'escape') { this.pasting = false; this.area = null; this.selected = null; this.renderSide(); }
    else if (k === 'delete' || k === 'backspace') { if (this.area) this.clearArea(); else if (this.selected) this.removeSelected(); else return false; }
    else if (k === 'arrowleft') this.view.x -= step; else if (k === 'arrowright') this.view.x += step;
    else if (k === 'arrowup') this.view.y -= step; else if (k === 'arrowdown') this.view.y += step;
    else if (k === '+' || k === '=') this.zoom(1.25); else if (k === '-') this.zoom(0.8);
    else return false;
    this.draw();
    return true;
  }

  async show(tab) {
    if (tab) this.tab = tab;
    this.tabBrowse.classList.toggle('on', this.tab === 'browse');
    this.tabEdit.classList.toggle('on', this.tab === 'edit');
    this.tabBrowse.setAttribute('aria-selected', String(this.tab === 'browse'));
    this.tabEdit.setAttribute('aria-selected', String(this.tab === 'edit'));
    this.browseBox.style.display = this.tab === 'browse' ? '' : 'none';
    this.editBox.style.display = this.tab === 'edit' ? '' : 'none';
    if (this.tab === 'browse') await this.renderBrowse();
    else await this.renderEditor();
  }

  // ---- the Browser -------------------------------------------------------------------------
  // (the shared maps come with the server's part: until then, the maps subscribed to)
  async renderBrowse() {
    const subs = await store.all('maps');
    const list = el('div', { class: 'maplist' }, ...subs.map((r) => this.mapCard(r.map, [
      el('button', { class: 'btn small', onclick: async () => { await store.remove('maps', r.id); this.renderBrowse(); } }, 'Unsubscribe')])));
    this.browseBox.replaceChildren(el('div', { class: 'panel wide' }, el('h2', { text: 'Subscribed' }),
      el('div', { class: 'body' }, subs.length ? list : el('div', { class: 'note', text: 'Maps you subscribe to are kept on this device, and are in the Skirmish and Online map lists.' }))));
  }

  mapCard(map, actions) {
    const [w, h, px] = C.previewPixels(map, 2);
    const c = el('canvas', { width: w, height: h, class: 'mapthumb' });
    c.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
    return el('div', { class: 'mapcard' }, c,
      el('div', { class: 'meta' }, el('div', { class: 'name nospell', text: map.name || 'Untitled' }),
        el('div', { class: 'note', text: KIND_NAMES[map.kind] + ' · ' + map.w + '×' + map.h + (map.kind === 'skirmish' ? ' · ' + map.bases.length + ' players' : '') }),
        map.desc ? el('div', { class: 'note nospell', text: map.desc }) : null),
      el('div', { class: 'actions' }, ...actions));
  }

  // ---- the Editor ---------------------------------------------------------------------------
  async renderEditor() {
    if (!this.draft) return this.renderDrafts();
    this.renderEditing();
  }

  // The player's drafts, and new ones: blank, or from one of the game's maps.
  async renderDrafts() {
    const drafts = (await store.all('drafts')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const from = el('select', { 'aria-label': 'Start from' },
      el('option', { value: '', text: 'Start from a map of the game\'s…' }),
      el('optgroup', { label: 'Skirmish maps' }, ...this.ui.maps().filter((m) => m.source !== 'custom').map((m) => el('option', { value: 'skirmish:' + m.id, text: m.name }))),
      el('optgroup', { label: 'The story\'s levels' }, ...this.storyLevels().map((n) => el('option', { value: 'story:' + n, text: 'Level ' + n }))));
    const size = el('select', { 'aria-label': 'Size' }, ...[[24, 'Small (24×24)'], [40, 'Medium (40×40)'], [64, 'Large (64×64)'], [96, 'Huge (96×96)']]
      .map(([n, t]) => el('option', { value: n, text: t, selected: n === 40 })));
    const make = (kind) => {
      let map;
      const [src, id] = from.value.split(':');
      if (src === 'skirmish') map = C.fromGameMap(this.player.online.maps[id] || this.eclipse(), kind);
      else if (src === 'story') map = C.fromGameMap({ name: 'Level ' + id, map: this.storyMap(id) }, kind);
      else map = C.blank(kind, Number(size.value), Number(size.value));
      map.name = map.name || 'My map';
      if (kind === 'skirmish' && map.bases.length < 2) map.bases = [{ x: 4, y: 4 }, { x: map.w - 3, y: map.h - 3 }].filter((b) => C.walkable(map, b.x, b.y));
      this.edit({ id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), map, updated: Date.now() });
    };
    const file = el('input', { type: 'file', accept: '.json,.cacmap,application/json', style: 'display:none', onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const v = C.validate(JSON.parse(await f.text()));
        if (!v.ok && !v.map) throw new Error(v.errors.join('; '));
        this.edit({ id: 'd' + Date.now().toString(36), map: v.map || JSON.parse(await f.text()), updated: Date.now() });
      } catch (err) {
        this.ui.toast('That file is not a map this game can open: ' + err.message);
      }
    } });
    this.editBox.replaceChildren(
      el('div', { class: 'panel wide' }, el('h2', { text: 'New map' }), el('div', { class: 'body' },
        el('div', { class: 'form' }, el('label', { text: 'Size' }), size, el('label', { text: 'Or' }), from),
        el('div', { class: 'actions' },
          el('button', { class: 'btn small', onclick: () => make('skirmish') }, 'New skirmish map'),
          el('button', { class: 'btn small', onclick: () => make('story') }, 'New singleplayer map'),
          el('button', { class: 'btn small', onclick: () => file.click() }, 'Open a file…'), file))),
      el('div', { class: 'panel wide' }, el('h2', { text: 'Your maps' }), el('div', { class: 'body' },
        drafts.length ? el('div', { class: 'maplist' }, ...drafts.map((d) => this.mapCard(d.map, [
          el('button', { class: 'btn small', onclick: () => this.edit(d) }, 'Edit'),
          el('button', { class: 'btn small', onclick: () => this.edit({ id: 'd' + Date.now().toString(36), map: JSON.parse(JSON.stringify(Object.assign({}, d.map, { name: (d.map.name + ' copy').slice(0, C.LIMITS.name) }))), updated: Date.now() }) }, 'Copy'),
          el('button', { class: 'btn small', onclick: async () => { if (confirm('Delete "' + (d.map.name || 'Untitled') + '"?')) { await store.remove('drafts', d.id); this.renderDrafts(); } } }, 'Delete')])))
          : el('div', { class: 'note', text: 'Maps you make are kept on this device.' }))));
  }

  storyLevels() {
    try {
      const data = this.ui.game.mapData();
      return Object.keys(data).filter((k) => /^map\d+$/.test(k)).map((k) => Number(k.slice(3))).sort((a, b) => a - b);
    } catch (e) {
      return [];
    }
  }

  storyMap(n) {
    const m = this.ui.game.mapData()['map' + n];
    return Array.isArray(m) ? m.join('') : String(m);
  }

  eclipse() { return { name: 'Eclipse', map: this.storyMap(10), bases: [{ x: 5, y: 19 }, { x: 25, y: 11 }] }; }

  edit(draft) {
    this.draft = draft;
    this.undo = [];
    this.redo = [];
    this.selected = null;
    this.tool = draft.map.kind === 'skirmish' ? 'rock' : 'rock';
    this.fitPending = true;           // (the whole map in view, once the canvas has its size: draw)
    this.view.x = 0;
    this.view.y = 0;
    this.save();
    this.renderEditing();
  }

  async save() {
    if (!this.draft) return;
    this.draft.updated = Date.now();
    await store.put('drafts', JSON.parse(JSON.stringify(this.draft)));
  }

  snapshot() {
    this.undo.push(JSON.stringify(this.draft.map));
    if (this.undo.length > 60) this.undo.shift();
    this.redo = [];
  }

  back(stack, other) {
    if (!stack.length) return;
    other.push(JSON.stringify(this.draft.map));
    this.draft.map = JSON.parse(stack.pop());
    this.selected = null;
    this.changed();
    this.renderSide();
  }

  // The map changed: drawn again, checked again (a moment later), kept.
  changed() {
    this.draw();
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => { this.renderChecks(); this.save(); }, 250);
  }

  renderEditing() {
    const map = this.draft.map;
    this.canvas = el('canvas', { class: 'editmap', tabindex: 0, 'aria-label': 'The map' });
    this.wireCanvas();
    const toolbar = el('div', { class: 'tools' }, ...TOOLS.filter(([k]) => this.toolFits(k)).map(([k, name, title]) =>
      el('button', { class: 'tool' + (this.tool === k ? ' on' : ''), title, onclick: () => { this.tool = k; this.renderEditing(); } }, name)));
    const brush = el('select', { 'aria-label': 'Brush size', onchange: (e) => { this.brush = Number(e.target.value); } },
      ...[1, 2, 3, 5, 8].map((n) => el('option', { value: n, text: n + '×' + n, selected: n === this.brush })));
    const toolOptions = this.toolOptions(brush);
    this.side = el('div', { class: 'edit-side' });
    this.checks = el('div', { class: 'checks' });
    this.editBox.replaceChildren(el('div', { class: 'editor' },
      el('div', { class: 'edit-main' },
        el('div', { class: 'edit-bar' },
          el('button', { class: 'btn small', onclick: async () => { await this.save(); this.draft = null; this.renderDrafts(); } }, 'Your maps'),
          el('button', { class: 'btn small', title: 'Undo (Ctrl+Z)', onclick: () => this.back(this.undo, this.redo) }, 'Undo'),
          el('button', { class: 'btn small', title: 'Redo (Ctrl+Y)', onclick: () => this.back(this.redo, this.undo) }, 'Redo'),
          el('button', { class: 'btn small', title: 'Copy the area (Ctrl+C)', onclick: () => this.copyArea(false) }, 'Copy'),
          el('button', { class: 'btn small', title: 'Cut the area (Ctrl+X)', onclick: () => this.copyArea(true) }, 'Cut'),
          el('button', { class: 'btn small', title: 'Paste where you click next (Ctrl+V)', onclick: () => this.startPaste() }, 'Paste'),
          el('button', { class: 'btn small', title: 'Zoom in', onclick: () => this.zoom(1.25) }, '+'),
          el('button', { class: 'btn small', title: 'Zoom out', onclick: () => this.zoom(0.8) }, '−'),
          el('button', { class: 'btn small', onclick: () => this.testPlay() }, 'Test play'),
          el('button', { class: 'btn small', onclick: () => this.exportFile() }, 'Save as file')),
        toolbar, toolOptions,
        el('div', { class: 'edit-canvas' }, this.canvas),
        el('div', { class: 'note', text: 'Draw with the mouse or a finger; move the map with the right mouse button, two fingers or the arrow keys; zoom with the wheel, a pinch or + and −.' })),
      this.side));
    this.renderSide();
    // (drawn now, so that the canvas has its size for the next press, and again once laid out)
    this.draw();
    requestAnimationFrame(() => this.draw());
    this.renderChecks();
  }

  toolFits(k) {
    const kind = this.draft.map.kind;
    if (k === 'base') return kind === 'skirmish';
    if (k === 'thing' || k === 'item' || k === 'reveal') return kind === 'story';
    return true;
  }

  // The chosen tool's own choices: brush size, the exact tile, the thing or item to put down.
  toolOptions(brush) {
    const t = this.tool;
    const row = (...kids) => el('div', { class: 'tool-options' }, ...kids);
    const shapes = el('div', { class: 'shapes' }, ...SHAPES.map(([k, name]) => el('button', { class: 'tool' + (this.shape === k ? ' on' : ''),
      title: k === 'rect' || k === 'ellipse' ? name + ' (Shift: just its outline)' : name, onclick: () => { this.shape = k; this.renderEditing(); } }, name)));
    if (['open', 'rock', 'pool', 'crystal'].includes(t)) return row(shapes, el('label', { text: 'Size' }), brush);
    if (t === 'tile') {
      const pick = el('div', { class: 'tilepick' }, ...Array.from({ length: C.TILE_COUNT }, (_, id) => {
        const k = C.kindOf(id);
        return el('button', { class: 'tilebtn k' + k + (id === this.tileId ? ' on' : ''), title: 'Piece ' + id + ' (' + ['open', 'rock', 'water', 'crystals'][k] + ')',
          onclick: () => { this.tileId = id; this.renderEditing(); } }, String(id));
      }));
      return el('div', {}, row(shapes), row(el('label', { text: 'Piece' }), pick));
    }
    if (t === 'thing') {
      const types = el('select', { 'aria-label': 'What', onchange: (e) => { this.thingType = e.target.value; } },
        el('optgroup', { label: 'Buildings' }, ...C.BUILDINGS.map((x) => el('option', { value: x, text: this.title(x), selected: x === this.thingType }))),
        el('optgroup', { label: 'Units' }, ...C.UNITS.map((x) => el('option', { value: x, text: this.title(x), selected: x === this.thingType }))));
      const own = el('select', { 'aria-label': 'Whose', onchange: (e) => { this.thingOwn = e.target.value; } },
        el('option', { value: 'player', text: 'The player\'s', selected: this.thingOwn === 'player' }),
        el('option', { value: 'enemy', text: 'The enemy\'s', selected: this.thingOwn === 'enemy' }));
      return row(el('label', { text: 'Put down' }), types, own);
    }
    if (t === 'item') {
      const kinds = el('select', { 'aria-label': 'Item', onchange: (e) => { this.itemKind = e.target.value; this.renderEditing(); } },
        ...C.ITEMS.map((k) => el('option', { value: k, text: ITEM_NAMES[k], selected: k === this.itemKind })));
      const unit = this.itemKind === 'crate' ? el('select', { 'aria-label': 'In the crate', onchange: (e) => { this.crateUnit = e.target.value; } },
        ...C.UNITS.map((x) => el('option', { value: x, text: this.title(x), selected: x === this.crateUnit }))) : null;
      return row(el('label', { text: 'Put down' }), kinds, unit);
    }
    if (t === 'reveal') {
      return row(el('label', { text: 'Radius' }), el('select', { 'aria-label': 'Radius', onchange: (e) => { this.revealR = Number(e.target.value); } },
        ...[2, 3, 4, 6, 8, 12].map((n) => el('option', { value: n, text: n + ' cells', selected: n === this.revealR }))));
    }
    return row(el('span', { class: 'note', text: (TOOLS.find(([k]) => k === t) || [])[2] || '' }));
  }

  title(type) {
    try {
      const t = this.ui.game.dialogue('int_' + type + '_title');
      if (t) return t + (/_good$/.test(type) ? ' (Astro)' : ' (Alien)');
    } catch (e) {
      // (the game not yet loaded)
    }
    return type;
  }

  // ---- the side: the map's settings, the selected thing, the checks -------------------------------
  renderSide() {
    if (!this.side) return;
    const map = this.draft.map;
    const set = (fn) => { this.snapshot(); fn(); this.changed(); };
    const name = el('input', { type: 'text', class: 'nospell', maxlength: C.LIMITS.name, value: map.name, 'aria-label': 'Name',
      onchange: (e) => set(() => { map.name = e.target.value; }) });
    const desc = el('textarea', { class: 'nospell', maxlength: C.LIMITS.desc, rows: 3, 'aria-label': 'Description', onchange: (e) => set(() => { map.desc = e.target.value; }) });
    desc.value = map.desc || '';
    const palette = el('select', { 'aria-label': 'Palette', onchange: (e) => set(() => { map.palette = e.target.value; }) },
      ...PALETTES.map(([k, t]) => el('option', { value: k, text: t, selected: map.palette === k })));
    const music = el('select', { 'aria-label': 'Music', onchange: (e) => set(() => { map.music = Number(e.target.value); }) },
      ...C.MUSIC.map((n) => el('option', { value: n, text: 'Track ' + n, selected: map.music === n })));
    const w = el('input', { type: 'number', min: C.MIN_SIZE, max: C.MAX_SIZE, value: map.w, 'aria-label': 'Width' });
    const h = el('input', { type: 'number', min: C.MIN_SIZE, max: C.MAX_SIZE, value: map.h, 'aria-label': 'Height' });
    const anchor = el('select', { 'aria-label': 'Keep in place' },
      ...[['0,0', 'Top left'], ['0.5,0.5', 'Middle'], ['1,1', 'Bottom right']].map(([v, t]) => el('option', { value: v, text: t })));
    const resize = el('button', { class: 'btn small', onclick: () => {
      const nw = Math.max(C.MIN_SIZE, Math.min(C.MAX_SIZE, Number(w.value) || map.w)), nh = Math.max(C.MIN_SIZE, Math.min(C.MAX_SIZE, Number(h.value) || map.h));
      const [ax, ay] = anchor.value.split(',').map(Number);
      this.snapshot();
      this.draft.map = C.resize(map, nw, nh, ax, ay);
      this.changed();
      this.renderSide();
    } }, 'Resize');
    const mirror = (how) => el('button', { class: 'btn small', onclick: () => { this.snapshot(); this.mirror(how); this.changed(); this.renderSide(); } },
      { lr: 'Mirror left to right', tb: 'Mirror top to bottom', rot: 'Copy turned (half turn)' }[how]);
    const parts = [
      el('div', { class: 'panel' }, el('h2', { text: 'Map' }), el('div', { class: 'body form' },
        el('label', { text: 'Name' }), name, el('label', { text: 'Description' }), desc,
        el('label', { text: 'Kind' }), el('div', { text: KIND_NAMES[map.kind] }),
        el('label', { text: 'Palette' }), palette, el('label', { text: 'Music' }), music,
        el('label', { text: 'Size' }), el('div', { class: 'sizes' }, w, '×', h), el('label', { text: 'Keep in place' }), anchor,
        el('div', { class: 'wide actions' }, resize),
        el('div', { class: 'wide actions' }, mirror('lr'), mirror('tb'), mirror('rot')))),
    ];
    if (map.kind === 'story') parts.push(this.storyPanel(set));
    parts.push(this.selectedPanel(set));
    parts.push(el('div', { class: 'panel' }, el('h2', { text: 'Checks' }), el('div', { class: 'body' }, this.checks)));
    this.side.replaceChildren(...parts);
  }

  storyPanel(set) {
    const s = this.draft.map.story;
    const side = el('select', { 'aria-label': 'Player\'s side', onchange: (e) => set(() => { s.side = e.target.value; }) },
      ...['good', 'evil'].map((k) => el('option', { value: k, text: NAMES[k], selected: s.side === k })));
    const cash = el('input', { type: 'number', min: 0, max: C.LIMITS.cash, step: 500, value: s.cash, 'aria-label': 'Starting cash',
      onchange: (e) => set(() => { s.cash = Math.max(0, Math.min(C.LIMITS.cash, Math.round(Number(e.target.value) || 0))); }) });
    const win = el('select', { 'aria-label': 'To win', onchange: (e) => set(() => { s.win = { k: e.target.value }; this.renderSide(); }) },
      ...C.WINS.map((k) => el('option', { value: k, text: WIN_NAMES[k], selected: s.win.k === k })));
    const extra = [];
    if (s.win.k === 'infiltrate' || s.win.k === 'protect') {
      const u = s.units[s.win.n];
      extra.push(el('label', { text: s.win.k === 'infiltrate' ? 'Which building' : 'What' }),
        el('div', { class: 'note', text: u ? this.title(u.t) + ' at ' + u.x + ',' + u.y : 'Select one on the map, then "' + (s.win.k === 'infiltrate' ? 'Infiltrate this' : 'Protect this') + '"' }));
    }
    if (s.win.k === 'protect' || s.win.k === 'survive') {
      extra.push(el('label', { text: 'For (seconds)' }), el('input', { type: 'number', min: 0, max: C.LIMITS.seconds, step: 30, value: s.win.s || (s.win.k === 'survive' ? 300 : 0), 'aria-label': 'Seconds',
        onchange: (e) => set(() => { s.win.s = Math.max(0, Math.min(C.LIMITS.seconds, Math.round(Number(e.target.value) || 0))); }) }));
      if (s.win.k === 'protect') extra.push(el('div', { class: 'wide note', text: '0: until the enemy is beaten.' }));
    }
    if (s.win.k === 'collect') {
      extra.push(el('label', { text: 'Which items' }), el('select', { 'aria-label': 'Which items', onchange: (e) => set(() => { s.win.k2 = e.target.value; }) },
        el('option', { value: 'any', text: 'Any', selected: !s.win.k2 || s.win.k2 === 'any' }), ...C.ITEMS.map((k) => el('option', { value: k, text: ITEM_NAMES[k], selected: s.win.k2 === k }))),
      el('label', { text: 'How many' }), el('input', { type: 'number', min: 1, max: C.LIMITS.collect, value: s.win.c || 1, 'aria-label': 'How many',
        onchange: (e) => set(() => { s.win.c = Math.max(1, Math.min(C.LIMITS.collect, Math.round(Number(e.target.value) || 1))); }) }));
    }
    return el('div', { class: 'panel' }, el('h2', { text: 'Singleplayer' }), el('div', { class: 'body form' },
      el('label', { text: 'The player plays' }), side, el('label', { text: 'Starting cash' }), cash, el('label', { text: 'To win' }), win, ...extra));
  }

  // The thing (or base, item, revealed patch) picked with Select: what it is, and its choices.
  selectedPanel(set) {
    const map = this.draft.map;
    const sel = this.selected;
    const body = el('div', { class: 'body form' });
    const box = el('div', { class: 'panel' }, el('h2', { text: 'Selected' }), body);
    if (!sel) { body.append(el('div', { class: 'wide note', text: 'Pick something on the map with Select.' })); return box; }
    const list = sel.list === 'bases' ? map.bases : map.story[sel.list];
    const it = list[sel.i];
    if (!it) { this.selected = null; body.append(el('div', { class: 'wide note', text: 'Pick something on the map with Select.' })); return box; }
    const remove = el('button', { class: 'btn small', onclick: () => { this.removeSelected(); } }, 'Delete');
    if (sel.list === 'bases') body.append(el('label', { text: 'Base' }), el('div', { text: String(sel.i + 1) + ' at ' + it.x + ',' + it.y }));
    if (sel.list === 'units') {
      const s = map.story;
      body.append(el('label', { text: 'What' }), el('div', { text: this.title(it.t) }),
        el('label', { text: 'Whose' }), el('select', { 'aria-label': 'Whose', onchange: (e) => set(() => { it.own = e.target.value; if (it.own === 'player') { delete it.b; delete it.d; } }) },
          el('option', { value: 'player', text: 'The player\'s', selected: it.own === 'player' }), el('option', { value: 'enemy', text: 'The enemy\'s', selected: it.own === 'enemy' })),
        el('label', { text: 'Facing' }), el('input', { type: 'range', min: 0, max: 7, value: Math.round((it.f === undefined ? 0.5 : it.f) * 8) % 8, 'aria-label': 'Facing',
          onchange: (e) => set(() => { it.f = Number(e.target.value) / 8; }) }),
        el('label', { text: 'Health' }), el('select', { 'aria-label': 'Health', onchange: (e) => set(() => { it.hp = Number(e.target.value); }) },
          ...[1, 0.75, 0.5, 0.25, 0.1].map((v) => el('option', { value: v, text: Math.round(v * 100) + '%', selected: (it.hp || 1) === v }))));
      if (it.own === 'enemy') {
        body.append(el('label', { text: 'Behaviour' }), el('select', { 'aria-label': 'Behaviour', onchange: (e) => set(() => { it.b = e.target.value; }) },
          ...C.BEHAVIOURS.map((b) => el('option', { value: b, text: BEHAVIOUR_NAMES[b], selected: (it.b || 'still') === b }))),
        el('label', { text: 'Wakes after (seconds)' }), el('input', { type: 'number', min: 0, max: Math.floor(C.LIMITS.delay / 23), value: Math.round((it.d || 0) / 23), 'aria-label': 'Wakes after',
          onchange: (e) => set(() => { it.d = Math.max(0, Math.min(C.LIMITS.delay, Math.round((Number(e.target.value) || 0) * 23))); }) }));
        if (it.t[0] === 'B') body.append(el('div', { class: 'wide actions' }, el('button', { class: 'btn small', onclick: () => set(() => { s.win = { k: 'infiltrate', n: sel.i }; this.renderSide(); }) }, 'Infiltrate this to win')));
      } else body.append(el('div', { class: 'wide actions' }, el('button', { class: 'btn small', onclick: () => set(() => { s.win = { k: 'protect', n: sel.i, s: (s.win && s.win.s) || 0 }; this.renderSide(); }) }, 'Protect this to win')));
    }
    if (sel.list === 'items') {
      body.append(el('label', { text: 'Item' }), el('div', { text: ITEM_NAMES[it.k] }));
      if (it.k === 'crate') body.append(el('label', { text: 'In it' }), el('select', { 'aria-label': 'In the crate', onchange: (e) => set(() => { it.u = e.target.value; }) },
        ...C.UNITS.map((x) => el('option', { value: x, text: this.title(x), selected: x === it.u }))));
    }
    if (sel.list === 'reveal') body.append(el('label', { text: 'Radius' }), el('input', { type: 'number', min: 1, max: 20, value: it.r, 'aria-label': 'Radius',
      onchange: (e) => set(() => { it.r = Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1))); }) }));
    body.append(el('div', { class: 'wide actions' }, remove));
    return box;
  }

  removeSelected() {
    const sel = this.selected;
    if (!sel) return;
    const map = this.draft.map;
    this.snapshot();
    if (sel.list === 'bases') map.bases.splice(sel.i, 1);
    else {
      map.story[sel.list].splice(sel.i, 1);
      // (the win's thing keeps pointing at the same one, or none)
      const w = map.story.win;
      if (sel.list === 'units' && w.n !== undefined) { if (w.n === sel.i) map.story.win = { k: 'all' }; else if (w.n > sel.i) w.n--; }
    }
    this.selected = null;
    this.changed();
    this.renderSide();
  }

  renderChecks() {
    if (!this.checks || !this.draft) return;
    const v = C.validate(JSON.parse(JSON.stringify(this.draft.map)));
    const advice = C.advice(this.draft.map);
    const name = this.draft.map.name || '';
    const rows = [];
    if (name && !isClean(name)) rows.push(el('div', { class: 'bad', text: 'The name has a word that is not allowed.' }));
    if (this.draft.map.desc && !isClean(this.draft.map.desc)) rows.push(el('div', { class: 'bad', text: 'The description has a word that is not allowed.' }));
    for (const e of v.errors) rows.push(el('div', { class: 'bad', text: 'Needs ' + e + '.' }));
    for (const a of advice) rows.push(el('div', { class: 'note', text: a }));
    if (v.ok && !rows.some((r) => r.className === 'bad')) rows.unshift(el('div', { class: 'good', text: 'Ready to play' + (this.draft.map.kind === 'skirmish' ? ' (' + this.draft.map.bases.length + ' players)' : '') + '.' }));
    this.checks.replaceChildren(...rows);
    this.valid = v.ok;
  }

  // ---- drawing --------------------------------------------------------------------------------
  draw() {
    const c = this.canvas;
    if (!c || !this.draft) return;
    const map = this.draft.map;
    const box = c.parentElement ? c.parentElement.getBoundingClientRect() : { width: 800, height: 500 };
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(200, Math.floor(box.width)), ch = Math.max(200, Math.min(Math.floor(window.innerHeight * 0.62), 720));
    if (c.width !== cw * dpr || c.height !== ch * dpr) { c.width = cw * dpr; c.height = ch * dpr; c.style.width = cw + 'px'; c.style.height = ch + 'px'; }
    if (this.fitPending) {
      this.fitPending = false;
      this.view.cell = Math.max(3, Math.min(28, Math.floor(Math.min(cw / (map.w * 2), ch / map.h))));
      this.view.x = -Math.max(0, (cw - map.w * 2 * this.view.cell) / 2);
      this.view.y = -Math.max(0, (ch - map.h * this.view.cell) / 2);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#111';
    g.fillRect(0, 0, cw, ch);
    const W = this.view.cell * 2, H = this.view.cell;          // (the game's cells are twice as wide as tall)
    const ox = -this.view.x, oy = -this.view.y;
    const pal = (C.PREVIEW_COLOURS[map.palette] || C.PREVIEW_COLOURS[/hive/.test(map.palette) ? 'hive' : /castle|pirate/.test(map.palette) ? 'hive' : 'mars']);
    const rgb = (a, k = 1) => 'rgb(' + a.map((v) => Math.round(v * k)).join(',') + ')';
    const solid = C.solidCells(map);
    const x0 = Math.max(1, Math.floor(-ox / W) + 1), y0 = Math.max(1, Math.floor(-oy / H) + 1);
    const x1 = Math.min(map.w, Math.ceil((cw - ox) / W)), y1 = Math.min(map.h, Math.ceil((ch - oy) / H));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y - 1) * map.w + (x - 1);
      const id = C.ASCII.indexOf(map.tiles[i]);
      const k = solid.has(i) ? C.ROCK : C.kindOf(id);
      const px = ox + (x - 1) * W, py = oy + (y - 1) * H;
      g.fillStyle = k === C.ROCK ? rgb(pal.rock) : k === C.POOL ? rgb(pal.pool) : k === C.CRYSTAL ? rgb(pal.ground) : rgb(pal.ground, [25, 26, 27, 28, 46, 49, 50].includes(id) ? 0.85 : 1);
      g.fillRect(px, py, W + 0.5, H + 0.5);
      if (k === C.CRYSTAL) { g.fillStyle = rgb(pal.crystal); g.fillRect(px + W * 0.2, py + H * 0.2, W * 0.6, H * 0.6); }
      // (a piece's edge: a darker rim on the sides where it meets the open)
      if ((k === C.ROCK || k === C.POOL) && W >= 10) {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        const openAt = (dx, dy) => { const xx = x + dx, yy = y + dy; return xx >= 1 && yy >= 1 && xx <= map.w && yy <= map.h && C.walkable(map, xx, yy, solid); };
        if (openAt(0, 1)) g.fillRect(px, py + H - 2, W, 2);
        if (openAt(1, 0)) g.fillRect(px + W - 2, py, 2, H);
      }
    }
    if (W >= 14) {
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = x0; x <= x1 + 1; x++) { g.moveTo(ox + (x - 1) * W + 0.5, oy + (y0 - 1) * H); g.lineTo(ox + (x - 1) * W + 0.5, oy + y1 * H); }
      for (let y = y0; y <= y1 + 1; y++) { g.moveTo(ox + (x0 - 1) * W, oy + (y - 1) * H + 0.5); g.lineTo(ox + x1 * W, oy + (y - 1) * H + 0.5); }
      g.stroke();
    }
    const at = (p) => [ox + (p.x - 0.5) * W, oy + (p.y - 0.5) * H];
    const label = (txt, x, y, col) => { g.font = 'bold ' + Math.max(9, Math.min(14, H)) + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(txt, x, y); };
    const isSel = (list, i) => this.selected && this.selected.list === list && this.selected.i === i;
    map.bases.forEach((b, i) => {
      const [x, y] = at(b);
      g.fillStyle = BASE_COLOURS[i % BASE_COLOURS.length];
      g.beginPath(); g.ellipse(x, y, W * 0.9, H * 0.9, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = isSel('bases', i) ? '#fff' : '#000'; g.lineWidth = isSel('bases', i) ? 3 : 1.5; g.stroke();
      label(String(i + 1), x, y, '#000');
    });
    if (map.story) {
      for (const [i, r] of map.story.reveal.entries()) {
        const [x, y] = at(r);
        g.setLineDash([4, 4]); g.strokeStyle = isSel('reveal', i) ? '#fff' : 'rgba(255,255,255,0.6)'; g.lineWidth = 1.5;
        g.beginPath(); g.ellipse(x, y, r.r * W, r.r * H, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      }
      for (const [i, it] of map.story.items.entries()) {
        const [x, y] = at(it);
        g.fillStyle = { crate: '#c8a050', cash: '#f0d040', gift: '#e0303c', pizza: '#ffb050' }[it.k];
        g.beginPath(); g.moveTo(x, y - H * 0.6); g.lineTo(x + W * 0.45, y); g.lineTo(x, y + H * 0.6); g.lineTo(x - W * 0.45, y); g.closePath(); g.fill();
        g.strokeStyle = isSel('items', i) ? '#fff' : '#000'; g.lineWidth = isSel('items', i) ? 3 : 1; g.stroke();
      }
      const win = map.story.win;
      for (const [i, u] of map.story.units.entries()) {
        const [x, y] = at(u);
        const big = u.t[0] === 'B';
        const sw = big ? W * 1.6 : W * 0.8, sh = big ? H * 1.6 : H * 0.8;
        g.fillStyle = u.own === 'player' ? (map.story.side === 'evil' ? '#3cb43c' : '#ff8c00') : '#c82828';
        g.fillRect(x - sw / 2, y - sh / 2, sw, sh);
        g.strokeStyle = isSel('units', i) ? '#fff' : '#000'; g.lineWidth = isSel('units', i) ? 3 : 1; g.strokeRect(x - sw / 2, y - sh / 2, sw, sh);
        if (W >= 12) label(u.t.slice(0, 2), x, y, '#fff');
        if (win.n === i && (win.k === 'infiltrate' || win.k === 'protect')) { g.strokeStyle = '#ffe000'; g.lineWidth = 2; g.strokeRect(x - sw / 2 - 3, y - sh / 2 - 3, sw + 6, sh + 6); }
      }
    }
    // the shape being drawn, the marked area, and where a paste would go
    const outline = (x0, y0, x1, y1, col, dash) => {
      g.setLineDash(dash ? [6, 4] : []); g.strokeStyle = col; g.lineWidth = 2;
      g.strokeRect(ox + (Math.min(x0, x1) - 1) * W + 1, oy + (Math.min(y0, y1) - 1) * H + 1, (Math.abs(x1 - x0) + 1) * W - 2, (Math.abs(y1 - y0) + 1) * H - 2);
      g.setLineDash([]);
    };
    if (this.shapeShown) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (const [x, y] of this.shapeCells(this.shapeShown)) g.fillRect(ox + (x - 1) * W, oy + (y - 1) * H, W, H);
    }
    if (this.area) outline(this.area.x0, this.area.y0, this.area.x1, this.area.y1, '#ffe000', true);
    if (this.pasting && this.clip && this.hover) { outline(this.hover.x, this.hover.y, this.hover.x + this.clip.w - 1, this.hover.y + this.clip.h - 1, '#4cf', true); return; }
    // the hovered cell
    if (this.hover) {
      const n = ['open', 'rock', 'pool', 'crystal'].includes(this.tool) && ['free', 'line'].includes(this.shape) ? this.brush : 1;
      const hx = this.hover.x - Math.floor((n - 1) / 2), hy = this.hover.y - Math.floor((n - 1) / 2);
      g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.strokeRect(ox + (hx - 1) * W + 0.5, oy + (hy - 1) * H + 0.5, n * W - 1, n * H - 1);
    }
  }

  // ---- input ----------------------------------------------------------------------------------
  cellAt(ev) {
    const r = this.canvas.getBoundingClientRect();
    const W = this.view.cell * 2, H = this.view.cell;
    return { x: Math.floor((ev.clientX - r.left + this.view.x) / W) + 1, y: Math.floor((ev.clientY - r.top + this.view.y) / H) + 1 };
  }

  zoom(k, cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    cx = cx === undefined ? r.width / 2 : cx;
    cy = cy === undefined ? r.height / 2 : cy;
    const before = this.view.cell;
    this.view.cell = Math.max(3, Math.min(48, before * k));
    const f = this.view.cell / before;
    this.view.x = (this.view.x + cx) * f - cx;
    this.view.y = (this.view.y + cy) * f - cy;
    this.draw();
  }

  wireCanvas() {
    const c = this.canvas;
    const pointers = new Map();
    let stroke = null, pan = null, pinch = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { e.preventDefault(); const r = c.getBoundingClientRect(); this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // two fingers: the map moved and zoomed, the stroke dropped
        stroke = null;
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        return;
      }
      if (e.button === 1 || e.button === 2) { pan = { x: e.clientX, y: e.clientY }; return; }
      stroke = this.begin(this.cellAt(e), e);
    });
    c.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const r = c.getBoundingClientRect();
        this.view.x -= cx - pinch.cx; this.view.y -= cy - pinch.cy;
        if (pinch.d > 0) this.zoom(d / pinch.d, cx - r.left, cy - r.top);
        pinch = { d, cx, cy };
        this.draw();
        return;
      }
      if (pan) { this.view.x -= e.clientX - pan.x; this.view.y -= e.clientY - pan.y; pan = { x: e.clientX, y: e.clientY }; this.draw(); return; }
      this.hover = this.cellAt(e);
      if (stroke) this.continue(stroke, this.hover);
      else this.draw();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (stroke) { this.finish(stroke); stroke = null; }
      pan = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
  }

  inside(p) { const m = this.draft.map; return p.x >= 1 && p.y >= 1 && p.x <= m.w && p.y <= m.h; }

  // A press on the map with the tool: painting, putting down, or picking (and dragging).
  begin(p, ev) {
    if (!this.inside(p)) return null;
    const map = this.draft.map;
    if (this.pasting && this.clip) { this.snapshot(); this.pasteAt(p); this.pasting = false; this.changed(); this.renderSide(); return null; }
    const t = this.tool;
    if (t === 'area') { this.area = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; this.draw(); return { kind: 'area', from: p }; }
    this.snapshot();
    if (PAINTS.includes(t)) {
      if (this.shape === 'fill') { this.applyCells(this.fillCells(p)); this.changed(); return null; }
      if (this.shape !== 'free') return { kind: 'shape', from: p, to: p, outline: !!(ev && ev.shiftKey) };
      const s = { kind: 'paint', last: null }; this.continue(s, p); return s;
    }
    if (t === 'select') {
      const hit = this.hitTest(p);
      this.selected = hit;
      this.renderSide();
      this.draw();
      return hit ? { kind: 'drag', from: p } : null;
    }
    if (t === 'base') {
      if (map.bases.length >= C.LIMITS.bases) { this.ui.toast('A map has ' + C.LIMITS.bases + ' bases at most.'); this.undo.pop(); return null; }
      map.bases.push({ x: p.x, y: p.y });
      this.selected = { list: 'bases', i: map.bases.length - 1 };
    }
    if (t === 'thing') {
      if (map.story.units.length >= C.LIMITS.units) { this.undo.pop(); return null; }
      const u = { t: this.thingType, x: p.x, y: p.y, f: 0.5, own: this.thingOwn, hp: 1 };
      if (u.own === 'enemy') { u.b = 'still'; u.d = 0; }
      map.story.units.push(u);
      this.selected = { list: 'units', i: map.story.units.length - 1 };
    }
    if (t === 'item') {
      if (map.story.items.length >= C.LIMITS.items) { this.undo.pop(); return null; }
      const it = { k: this.itemKind, x: p.x, y: p.y };
      if (it.k === 'crate') it.u = this.crateUnit;
      map.story.items.push(it);
      this.selected = { list: 'items', i: map.story.items.length - 1 };
    }
    if (t === 'reveal') {
      if (map.story.reveal.length >= C.LIMITS.reveal) { this.undo.pop(); return null; }
      map.story.reveal.push({ x: p.x, y: p.y, r: this.revealR });
      this.selected = { list: 'reveal', i: map.story.reveal.length - 1 };
    }
    this.changed();
    this.renderSide();
    return null;
  }

  continue(s, p) {
    if (!s || !this.inside(p)) return;
    const map = this.draft.map;
    if (s.kind === 'shape') { s.to = p; this.shapeShown = s; this.draw(); return; }
    if (s.kind === 'area') { this.area = { x0: s.from.x, y0: s.from.y, x1: p.x, y1: p.y }; this.draw(); return; }
    if (s.kind === 'paint') {
      if (s.last && s.last.x === p.x && s.last.y === p.y) return;
      // (a line from the last cell, so a fast stroke leaves no gaps)
      const cells = [];
      const from = s.last || p;
      const n = Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y), 1);
      for (let k = 0; k <= n; k++) {
        const cx = Math.round(from.x + (p.x - from.x) * k / n), cy = Math.round(from.y + (p.y - from.y) * k / n);
        const b = this.tool === 'tile' ? 1 : this.brush, o = Math.floor((b - 1) / 2);
        for (let dy = 0; dy < b; dy++) for (let dx = 0; dx < b; dx++) cells.push([cx - o + dx, cy - o + dy]);
      }
      this.applyCells(cells);
      s.last = p;
      this.draw();
    }
    if (s.kind === 'drag' && this.selected) {
      const sel = this.selected;
      const list = sel.list === 'bases' ? map.bases : map.story[sel.list];
      const it = list[sel.i];
      if (it && (it.x !== p.x || it.y !== p.y)) { it.x = p.x; it.y = p.y; this.draw(); }
    }
  }

  finish(s) {
    if (s && s.kind === 'shape') { this.shapeShown = null; this.applyCells(this.shapeCells(s)); }
    if (s && s.kind === 'area') return;
    this.changed();
    if (s && s.kind === 'drag') this.renderSide();
  }

  // The tool's ground (or exact piece) laid on cells.
  applyCells(cells) {
    const map = this.draft.map;
    cells = cells.filter(([x, y]) => x >= 1 && y >= 1 && x <= map.w && y <= map.h);
    if (this.tool === 'tile') for (const [x, y] of cells) C.setTile(map, x, y, this.tileId);
    else C.paint(map, cells, { open: C.OPEN, rock: C.ROCK, pool: C.POOL, crystal: C.CRYSTAL }[this.tool]);
    this.draw();
  }

  // A line, rectangle or ellipse from where the press began to where it is now, as cells.
  shapeCells(s) {
    const b = this.tool === 'tile' ? 1 : this.brush, o = Math.floor((b - 1) / 2);
    const out = new Map();
    const add = (x, y, thick) => { const n = thick ? b : 1, oo = thick ? o : 0; for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.set((x - oo + dx) + ',' + (y - oo + dy), [x - oo + dx, y - oo + dy]); };
    const { from: a, to: z } = s;
    if (this.shape === 'line') {
      const n = Math.max(Math.abs(z.x - a.x), Math.abs(z.y - a.y), 1);
      for (let k = 0; k <= n; k++) add(Math.round(a.x + (z.x - a.x) * k / n), Math.round(a.y + (z.y - a.y) * k / n), true);
      return [...out.values()];
    }
    const x0 = Math.min(a.x, z.x), x1 = Math.max(a.x, z.x), y0 = Math.min(a.y, z.y), y1 = Math.max(a.y, z.y);
    if (this.shape === 'rect') {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const edge = x - x0 < b || x1 - x < b || y - y0 < b || y1 - y < b;
        if (!s.outline || edge) add(x, y, false);
      }
      return [...out.values()];
    }
    // (an ellipse in the rectangle, by the cells' middles)
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5;
    const inside = (x, y, rx2, ry2) => rx2 > 0 && ry2 > 0 && ((x - cx) / rx2) ** 2 + ((y - cy) / ry2) ** 2 <= 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!inside(x, y, rx, ry)) continue;
      if (!s.outline || !inside(x, y, rx - b, ry - b)) add(x, y, false);
    }
    return [...out.values()];
  }

  // Fill: the patch of the same ground as the cell pressed (the same piece, for the exact tool),
  // joined side to side.
  fillCells(p) {
    const map = this.draft.map;
    const solid = C.solidCells(map);
    const what = (x, y) => { const i = (y - 1) * map.w + (x - 1); return this.tool === 'tile' ? C.tileAt(map, x, y) : solid.has(i) ? C.ROCK : C.kindOf(C.tileAt(map, x, y)); };
    const want = what(p.x, p.y);
    const seen = new Set(), out = [], todo = [[p.x, p.y]];
    while (todo.length) {
      const [x, y] = todo.pop();
      const i = (y - 1) * map.w + (x - 1);
      if (x < 1 || y < 1 || x > map.w || y > map.h || seen.has(i) || what(x, y) !== want) continue;
      seen.add(i);
      out.push([x, y]);
      todo.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return out;
  }

  // ---- copy and paste --------------------------------------------------------------------------
  areaBox() {
    const a = this.area;
    if (!a) return null;
    const map = this.draft.map;
    const x0 = Math.max(1, Math.min(a.x0, a.x1)), x1 = Math.min(map.w, Math.max(a.x0, a.x1));
    const y0 = Math.max(1, Math.min(a.y0, a.y1)), y1 = Math.min(map.h, Math.max(a.y0, a.y1));
    return { x0, y0, x1, y1 };
  }

  // The marked area's ground, exactly, and what stands in it -- cut: then cleared.
  copyArea(cut) {
    const box = this.areaBox();
    if (!box) { this.ui.toast('Mark an area with the Area tool first.'); return; }
    const map = this.draft.map;
    const solid = C.solidCells(map);
    const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
    const tiles = [], solidHere = [];
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
      const i = (y - 1) * map.w + (x - 1);
      tiles.push(map.tiles[i]);
      solidHere.push(solid.has(i));
    }
    const within = (q) => q.x >= box.x0 && q.x <= box.x1 && q.y >= box.y0 && q.y <= box.y1;
    const rel = (list) => (list || []).filter(within).map((q) => Object.assign({}, q, { x: q.x - box.x0, y: q.y - box.y0 }));
    this.clip = { w, h, tiles, solid: solidHere, bases: rel(map.bases), units: rel(map.story && map.story.units), items: rel(map.story && map.story.items), reveal: rel(map.story && map.story.reveal) };
    if (cut) this.clearArea();
    else this.ui.toast('Copied ' + w + '\u00d7' + h + ': Ctrl+V (or Paste), then click where its top left goes.');
  }

  // The marked area made open ground, and what stood in it gone.
  clearArea() {
    const box = this.areaBox();
    if (!box) return;
    const map = this.draft.map;
    this.snapshot();
    const cells = [];
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) cells.push([x, y]);
    C.paint(map, cells, C.OPEN);
    const out = (q) => !(q.x >= box.x0 && q.x <= box.x1 && q.y >= box.y0 && q.y <= box.y1);
    map.bases = map.bases.filter(out);
    if (map.story) {
      const keep = map.story.units.map(out);
      const win = map.story.win;
      if (win.n !== undefined && !keep[win.n]) map.story.win = { k: 'all' };
      else if (win.n !== undefined) win.n = keep.slice(0, win.n).filter(Boolean).length;
      map.story.units = map.story.units.filter(out);
      map.story.items = map.story.items.filter(out);
      map.story.reveal = map.story.reveal.filter(out);
    }
    this.selected = null;
    this.changed();
    this.renderSide();
  }

  startPaste() {
    if (!this.clip) { this.ui.toast('Copy an area first (the Area tool, then Copy).'); return; }
    this.pasting = true;
    this.ui.toast('Click where the top left of what you copied goes (Esc: not now).');
  }

  // What was copied, its top left at p: its pieces as they were, the pieces where it meets the
  // map around it chosen again, and what stood in it put down again (as many as the map takes).
  pasteAt(p) {
    const map = this.draft.map, clip = this.clip;
    const chars = map.tiles.split('');
    const solid = C.solidCells(map);
    const placed = [];
    for (let y = 0; y < clip.h; y++) for (let x = 0; x < clip.w; x++) {
      const X = p.x + x, Y = p.y + y;
      if (X < 1 || Y < 1 || X > map.w || Y > map.h) continue;
      const i = (Y - 1) * map.w + (X - 1);
      chars[i] = clip.tiles[y * clip.w + x];
      if (clip.solid[y * clip.w + x]) solid.add(i); else solid.delete(i);
      placed.push([X, Y]);
    }
    map.tiles = chars.join('');
    map.solid = C.runs(solid);
    // (the seam: the pasted edge and the ring around it, each cell's pieces chosen again)
    const ring = new Map();
    for (let y = p.y - 1; y <= p.y + clip.h; y++) for (let x = p.x - 1; x <= p.x + clip.w; x++) {
      if (x < 1 || y < 1 || x > map.w || y > map.h) continue;
      if (x > p.x && x < p.x + clip.w - 1 && y > p.y && y < p.y + clip.h - 1) continue;
      const i = (y - 1) * map.w + (x - 1);
      const k = solid.has(i) ? C.ROCK : C.kindOf(C.tileAt(map, x, y));
      if (!ring.has(k)) ring.set(k, []);
      ring.get(k).push([x, y]);
    }
    for (const [k, cells] of ring) C.paint(map, cells, k);
    const on = (q) => ({ x: q.x + p.x, y: q.y + p.y });
    const fits = (q) => q.x >= 1 && q.y >= 1 && q.x <= map.w && q.y <= map.h;
    if (map.kind === 'skirmish') for (const b of clip.bases) { const q = on(b); if (fits(q) && map.bases.length < C.LIMITS.bases) map.bases.push(q); }
    if (map.story) {
      for (const u of clip.units) { const q = Object.assign({}, u, on(u)); if (fits(q) && map.story.units.length < C.LIMITS.units) map.story.units.push(q); }
      for (const it of clip.items) { const q = Object.assign({}, it, on(it)); if (fits(q) && map.story.items.length < C.LIMITS.items) map.story.items.push(q); }
      for (const r of clip.reveal) { const q = Object.assign({}, r, on(r)); if (fits(q) && map.story.reveal.length < C.LIMITS.reveal) map.story.reveal.push(q); }
    }
    this.area = { x0: p.x, y0: p.y, x1: p.x + clip.w - 1, y1: p.y + clip.h - 1 };
  }

  hitTest(p) {
    const map = this.draft.map;
    const near = (q, r = 0) => Math.abs(q.x - p.x) <= r && Math.abs(q.y - p.y) <= r;
    for (let i = map.bases.length - 1; i >= 0; i--) if (near(map.bases[i], 1)) return { list: 'bases', i };
    if (map.story) {
      for (let i = map.story.units.length - 1; i >= 0; i--) if (near(map.story.units[i], map.story.units[i].t[0] === 'B' ? 1 : 0)) return { list: 'units', i };
      for (let i = map.story.items.length - 1; i >= 0; i--) if (near(map.story.items[i])) return { list: 'items', i };
      for (let i = map.story.reveal.length - 1; i >= 0; i--) if (near(map.story.reveal[i])) return { list: 'reveal', i };
    }
    return null;
  }

  // The map made fair for a skirmish: one half copied onto the other, mirrored (left to right,
  // top to bottom) or turned half round; the bases as well.
  mirror(how) {
    const map = this.draft.map;
    const kinds = [[], [], [], []];
    const solid = C.solidCells(map);
    const target = (x, y) => how === 'lr' ? [map.w + 1 - x, y] : how === 'tb' ? [x, map.h + 1 - y] : [map.w + 1 - x, map.h + 1 - y];
    const source = (x, y) => how === 'lr' ? x <= map.w / 2 : how === 'tb' ? y <= map.h / 2 : (y < (map.h + 1) / 2 || (y === (map.h + 1) / 2 && x <= map.w / 2));
    for (let y = 1; y <= map.h; y++) for (let x = 1; x <= map.w; x++) {
      if (!source(x, y)) continue;
      const i = (y - 1) * map.w + (x - 1);
      kinds[solid.has(i) ? C.ROCK : C.kindOf(C.tileAt(map, x, y))].push(target(x, y));
    }
    for (const k of [C.OPEN, C.ROCK, C.POOL, C.CRYSTAL]) C.paint(map, kinds[k], k);
    if (map.kind === 'skirmish') {
      const keep = map.bases.filter((b) => source(b.x, b.y));
      map.bases = keep.concat(keep.map((b) => { const [x, y] = target(b.x, b.y); return { x, y }; })).slice(0, C.LIMITS.bases);
    }
  }

  // ---- trying it -------------------------------------------------------------------------------
  // A skirmish on it straight away: the player at the first base, computer players at the rest.
  // (A singleplayer map plays as it would: Level.customStory.)
  testPlay() {
    const v = C.validate(JSON.parse(JSON.stringify(this.draft.map)));
    if (!v.ok) { this.ui.toast('Not yet: ' + v.errors.join('; ') + '.'); return; }
    const map = v.map;
    const id = 'custom-test';
    register(this.player, id, map);
    const p = this.ui.panel;
    if (!p) return;
    this.testing = true;
    const me = this.ui.settings;
    let settings;
    if (map.kind === 'skirmish') {
      const colours = ['blue', 'red', 'green', 'purple', 'cyan', 'yellow'].filter((c) => c !== me.colour);
      const players = map.bases.map((b, i) => (i === 0
        ? { name: me.name, faction: me.faction === 'evil' ? 'evil' : 'good', colour: me.colour, control: 'local', base: b, slot: 0 }
        : { name: 'Computer ' + (i + 1), faction: i % 2 ? 'evil' : 'good', colour: colours[(i - 1) % colours.length], control: 'bot', difficulty: 'medium', base: b, slot: i }));
      settings = { map: id, mode: 'all', cash: 10000, units: 3, prebuilt: false, shroud: true, superweapons: true, palette: map.palette, speed: 1, regrowth: 1,
        specops: 'on', opsHQ: true, crates: true, christmas: false, crateRate: 'normal', income: 0, build: 1, players };
    } else {
      settings = { map: id, mode: 'custom', story: map.story, cash: map.story.cash, units: 0, prebuilt: false, shroud: true, superweapons: true, palette: map.palette, speed: 1,
        regrowth: 1, specops: 'on', opsHQ: true, crates: false, music: map.music,
        players: [{ name: me.name, faction: map.story.side, colour: map.story.side === 'evil' ? 'green' : 'orange', control: 'local', team: 'player' },
          { name: 'Enemy', faction: map.story.side === 'evil' ? 'good' : 'evil', colour: map.story.side === 'evil' ? 'orange' : 'green', control: 'script', team: 'enemy' }] };
    }
    if (this.ui.hooks.setSpeed) this.ui.hooks.setSpeed(1);
    this.ui.close();
    p.startSkirmish(settings);
  }

  exportFile() {
    const blob = new Blob([JSON.stringify(this.draft.map)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: (this.draft.map.name || 'map').replace(/[^\w -]+/g, '').trim() + '.cacmap.json' });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
}
