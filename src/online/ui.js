// The online version's menus, in HTML over the game: the main menu, the skirmish lobby and
// the settings.  The game's own menus are still there for the story (STORY), and the game
// comes back here when a match or a story game ends (Online.menu, called from game.js).

import { COLOURS, COLOUR_CSS, loadSettings, saveSettings } from './settings.js';

const FACTIONS = { good: 'Astro', evil: 'Alien', random: 'Random' };
const DIFFICULTIES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

// The match settings, with the choices the lobby offers.  `ready` says whether the game does
// anything with a setting yet; the rest are shown, and marked as coming.
const MATCH = [
  { key: 'mode', label: 'Game mode', ready: true, choices: [['all', 'Destroy all'], ['structures', 'Destroy structures'], ['pizza', 'Pizza mode'], ['ctf', 'Capture the flag']], only: { pizza: false, ctf: false } },
  { key: 'cash', label: 'Starting money', ready: true, choices: [[2500, '$2,500'], [5000, '$5,000'], [7500, '$7,500'], [10000, '$10,000'], [15000, '$15,000'], [20000, '$20,000'], [30000, '$30,000'], [50000, '$50,000']] },
  { key: 'units', label: 'Starting units', ready: true, choices: [[0, 'None'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']] },
  { key: 'prebuilt', label: 'Base', ready: true, choices: [[false, 'HQ only'], [true, 'HQ, power, barracks']] },
  { key: 'specops', label: 'Special Ops', ready: false, choices: [['on', 'On'], ['tech', 'Need the tech centre'], ['off', 'Off']] },
  { key: 'crates', label: 'Crates', ready: false, choices: [[true, 'On'], [false, 'Off']] },
  { key: 'christmas', label: 'Christmas crate', ready: false, choices: [[true, 'On'], [false, 'Off']] },
  { key: 'crateRate', label: 'Crates appear', ready: false, choices: [['rare', 'Rarely'], ['normal', 'Normally'], ['often', 'Often']] },
  { key: 'income', label: 'Passive income', ready: true, choices: [[0, 'None'], [200, '$200 a minute'], [400, '$400 a minute'], [800, '$800 a minute']] },
  { key: 'pizzaCost', label: 'Pizza cost', ready: false, choices: [[25000, '$25,000'], [50000, '$50,000'], [100000, '$100,000']] },
  { key: 'speed', label: 'Game speed', ready: true, choices: [[0.75, 'Slow'], [1, 'Normal'], [1.25, 'Fast'], [1.5, 'Fastest']] },
  { key: 'shroud', label: 'Shroud', ready: true, choices: [[true, 'On'], [false, 'Off']] },
  { key: 'superweapons', label: 'Superweapons', ready: true, choices: [[true, 'On'], [false, 'Off']] },
  { key: 'factions', label: 'Factions', ready: true, choices: [['all', 'Astro and Alien'], ['good', 'Astro only'], ['evil', 'Alien only']] },
  { key: 'regrowth', label: 'Crystal regrowth', ready: true, choices: [[0, 'None'], [0.5, 'Slow'], [1, 'Normal'], [2, 'Fast']] },
  { key: 'palette', label: 'Map palette', ready: true, choices: [['mars', 'Mars'], ['snowy', 'Snowy']] },
];

const MATCH_DEFAULTS = {
  map: 10, slots: 2, mode: 'all', cash: 10000, units: 3, prebuilt: false, specops: 'on', crates: true,
  christmas: false, crateRate: 'normal', income: 0, pizzaCost: 50000, speed: 1, shroud: true,
  superweapons: true, factions: 'all', regrowth: 1, palette: 'mars',
};

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

export class OnlineUI {
  constructor(player, hooks) {
    this.player = player;
    this.hooks = hooks || {};          // setSpeed(f): the offline game's speed
    this.settings = loadSettings();
    this.match = Object.assign({}, MATCH_DEFAULTS, this.settings.lobby && this.settings.lobby.match);
    this.slots = this.defaultSlots(this.settings.lobby && this.settings.lobby.slots);
    this.root = el('div', { class: 'ui', 'aria-live': 'polite' });
    this.back = el('button', { class: 'btn small ui-back', onclick: () => this.leaveStory(), text: 'Main menu' });
    document.body.append(this.root, this.back);
    this.screens = {};
    this.buildMain();
    this.buildLobby();
    this.buildSettings();
    this.applyVolumes();
    // The game calls Online.menu() when a match or a story game is over.
    player.online.menu = (screen) => this.open(screen);
    this.watch();
  }

  // ---- the game ------------------------------------------------------------------------------
  get game() { return this.player.levels[1]; }
  get panel() { return this.game && this.game.panel; }

  sound(label) {
    const sfx = this.panel && this.panel.sfx;
    if (sfx && sfx.play) sfx.play(label);
  }

  // Keep the Main menu button over the game's own menus (the story's), and nowhere else.
  watch() {
    const tick = () => {
      const p = this.panel;
      const storyMenus = p && !this.root.classList.contains('shown') && !p.game && p.state !== 'hidden';
      this.back.classList.toggle('shown', !!storyMenus);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // The game is loaded: show the main menu over it.
  attach() {
    if (this.attached) return;
    this.attached = true;
    if (this.panel) this.panel.state = 'hidden';
    this.open('main');
  }

  open(screen) {
    const p = this.panel;
    if (p && !p.game) p.state = 'hidden';
    this.root.classList.add('shown');
    this.show(screen || 'main');
  }

  close() {
    this.root.classList.remove('shown');
  }

  show(name) {
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('active', k === name);
    if (name === 'lobby') this.renderLobby();
    if (name === 'settings') this.renderSettings();
    const first = this.screens[name] && this.screens[name].querySelector('button:not(:disabled), select, input');
    if (first) first.focus({ preventScroll: true });
  }

  story() {
    this.close();
    const p = this.panel;
    if (p) {
      p.state = 'splash';
      if (p.sfx) p.sfx.play('music_intro_start');
    }
  }

  leaveStory() {
    this.sound('INT_cursor_select');
    this.open('main');
  }

  // ---- the main menu ----------------------------------------------------------------------
  buildMain() {
    const go = (fn) => () => { this.sound('INT_cursor_select'); fn(); };
    const s = el('section', { class: 'screen main' },
      el('div', { class: 'logo' },
        el('div', { class: 'script', text: 'CrystAlien Conflict' }),
        el('div', { class: 'l1', text: 'CrystAlien' }),
        el('div', { class: 'l2', text: 'Conflict' }),
        el('div', { class: 'l3', text: 'Online' })),
      el('nav', { class: 'menu' },
        el('button', { class: 'btn', onclick: go(() => this.show('lobby')) }, 'Skirmish'),
        el('button', { class: 'btn', disabled: true }, 'Online', el('small', { text: 'Soon' })),
        el('button', { class: 'btn', onclick: go(() => this.story()) }, 'Story'),
        el('button', { class: 'btn', onclick: go(() => this.show('settings')) }, 'Settings')),
      el('div', { class: 'chars' },
        el('img', { class: 'astro', src: 'assets/online/astro.png', alt: '' }),
        el('img', { class: 'alien', src: 'assets/online/alien.png', alt: '' })),
      el('div', { class: 'footnote', text: 'CrystAlien Conflict was made by 4T2 Multimedia for LEGO in 2007. LEGO and Mars Mission are trademarks of the LEGO Group.' }));
    this.screens.main = s;
    this.root.append(s);
  }

  // ---- the lobby ------------------------------------------------------------------------------
  // The skirmish maps: the game's own (Eclipse), then those made from Command & Conquer's
  // and LEGO Battles' maps.  A map's id is its level number for the game's own.
  maps() {
    const all = (this.game && this.game.skirmishMaps && this.game.skirmishMaps()) || { 10: { name: 'Eclipse', bases: [{}, {}] } };
    const order = { undefined: 0, cnc: 1, lego: 2 };
    return Object.entries(all)
      .map(([id, m]) => ({ id: String(id), name: m.name, source: m.source, bases: Math.min(6, (m.bases || []).length || 2), info: m }))
      .sort((a, b) => (order[a.source] || 0) - (order[b.source] || 0) || a.name.localeCompare(b.name));
  }

  mapInfo() {
    return this.maps().find((m) => m.id === String(this.match.map)) || this.maps()[0];
  }

  defaultSlots(saved) {
    const me = this.settings;
    const slots = [];
    for (let i = 0; i < 6; i++) {
      const s = saved && saved[i];
      if (i === 0) {
        slots.push({ kind: 'you', name: me.name, faction: me.faction, colour: me.colour });
      } else if (s && (s.kind === 'bot' || s.kind === 'closed')) {
        slots.push({ kind: s.kind, faction: FACTIONS[s.faction] ? s.faction : 'random', colour: COLOURS.includes(s.colour) ? s.colour : COLOURS[i], difficulty: DIFFICULTIES[s.difficulty] ? s.difficulty : 'medium' });
      } else {
        // The first opponent plays the other faction in its own colour (unless that is the
        // player's); the rest take the colours nobody has.
        const other = me.faction === 'good' ? 'evil' : 'good';
        const free = COLOURS.filter((c) => c !== me.colour);
        const native = other === 'good' ? 'orange' : 'green';
        const colour = i === 1 && native !== me.colour ? native : free[i % free.length];
        slots.push({ kind: 'bot', faction: i === 1 ? other : 'random', colour, difficulty: 'medium' });
      }
    }
    return slots;
  }

  buildLobby() {
    this.mapSelect = el('select', { onchange: (e) => { this.match.map = e.target.value; this.renderLobby(); } });
    this.slotCount = el('select', { onchange: (e) => { this.match.slots = Number(e.target.value); this.renderLobby(); } });
    for (let n = 2; n <= 6; n++) this.slotCount.append(el('option', { value: n, text: n + ' players' }));
    this.mapPreview = el('canvas', { width: 64, height: 64 });
    this.mapName = el('div', { class: 'name' });
    this.mapPlayers = el('div', { class: 'players' });
    this.slotList = el('div', { class: 'slots' });
    this.lobbyNotice = el('div', { class: 'notice' });
    this.matchForm = el('div', { class: 'form two' });
    this.startButton = el('button', { class: 'btn small primary', onclick: () => this.start() }, 'Start');
    const s = el('section', { class: 'screen lobby' },
      el('div', { class: 'titlebar' }, el('h1', { text: 'Skirmish' }), el('div', { class: 'spacer' }),
        el('button', { class: 'btn small', onclick: () => { this.sound('INT_cursor_select'); this.show('main'); } }, 'Back'),
        this.startButton),
      el('div', { class: 'lobby-grid' },
        el('div', { class: 'panel' }, el('h2', { text: 'Players' }),
          el('div', { class: 'body' },
            el('div', { class: 'mapcard' }, this.mapPreview,
              el('div', { class: 'info' },
                el('div', { class: 'form' },
                  el('label', { text: 'Map' }), this.mapSelect,
                  el('label', { text: 'Slots' }), this.slotCount),
                this.mapName, this.mapPlayers)),
            this.slotList,
            el('div', { class: 'footnote', text: 'Players of the same colour are one team: allies with separate bases.' }),
            this.lobbyNotice)),
        el('div', { class: 'panel' }, el('h2', { text: 'Match' }), el('div', { class: 'body' }, this.matchForm))));
    this.screens.lobby = s;
    this.root.append(s);
  }

  renderLobby() {
    const maps = this.maps();
    const groups = { undefined: 'CrystAlien Conflict', cnc: 'Command & Conquer', lego: 'LEGO Battles' };
    const byGroup = {};
    for (const m of maps) (byGroup[m.source] = byGroup[m.source] || []).push(m);
    this.mapSelect.replaceChildren(...Object.entries(byGroup).map(([g, list]) => el('optgroup', { label: groups[g] || g },
      ...list.map((m) => el('option', { value: m.id, text: m.name + ' (' + m.bases + ')', selected: m.id === String(this.match.map) })))));
    const map = this.mapInfo();
    this.match.map = map.id;
    this.slotCount.value = String(this.match.slots);
    this.mapName.textContent = map.name;
    this.mapPlayers.textContent = map.bases + ' players';
    this.drawPreview(map);

    const me = this.slots[0];
    me.name = this.settings.name;
    const factionChoices = this.match.factions === 'all' ? ['good', 'evil', 'random'] : [this.match.factions];
    const rows = [];
    for (let i = 0; i < this.match.slots; i++) {
      const slot = this.slots[i];
      const over = i >= map.bases;
      if (!factionChoices.includes(slot.faction)) slot.faction = factionChoices[0];
      const kind = i === 0
        ? el('div', { class: 'who' }, el('span', { class: 'name', text: slot.name }))
        : el('select', { 'aria-label': 'Slot ' + (i + 1), onchange: (e) => { slot.kind = e.target.value; this.renderLobby(); } },
          el('option', { value: 'bot', text: 'Computer', selected: slot.kind === 'bot' }),
          el('option', { value: 'closed', text: 'Closed', selected: slot.kind === 'closed' }));
      const faction = el('select', { 'aria-label': 'Faction', disabled: slot.kind === 'closed', onchange: (e) => { slot.faction = e.target.value; if (i === 0) this.remember({ faction: slot.faction }); } },
        ...factionChoices.filter((f) => i > 0 || f !== 'random').map((f) => el('option', { value: f, text: FACTIONS[f], selected: slot.faction === f })));
      const colour = el('select', { 'aria-label': 'Colour', disabled: slot.kind === 'closed', onchange: (e) => { slot.colour = e.target.value; if (i === 0) this.remember({ colour: slot.colour }); this.renderLobby(); } },
        ...COLOURS.map((c) => el('option', { value: c, text: c[0].toUpperCase() + c.slice(1), selected: slot.colour === c })));
      const extra = i === 0
        ? el('div', { class: 'who', text: 'You' })
        : el('select', { 'aria-label': 'Difficulty', disabled: slot.kind !== 'bot', onchange: (e) => { slot.difficulty = e.target.value; } },
          ...Object.entries(DIFFICULTIES).map(([k, v]) => el('option', { value: k, text: v, selected: slot.difficulty === k })));
      rows.push(el('div', { class: 'slot' + (slot.kind === 'closed' ? ' closed' : '') + (over ? ' over' : '') },
        el('div', { class: 'num' }, el('span', { class: 'swatch', style: 'background:' + COLOUR_CSS[slot.colour], title: slot.colour })),
        kind, faction, colour, extra));
    }
    this.slotList.replaceChildren(...rows);

    this.matchForm.replaceChildren(...MATCH.flatMap((m) => {
      const select = el('select', { 'aria-label': m.label, disabled: !m.ready, onchange: (e) => {
        const c = m.choices.find(([v]) => String(v) === e.target.value);
        this.match[m.key] = c ? c[0] : this.match[m.key];
        this.renderLobby();
      } }, ...m.choices.map(([v, t]) => el('option', { value: String(v), text: t, selected: String(this.match[m.key]) === String(v), disabled: m.only && m.only[v] === false })));
      return [el('label', {}, m.label, m.ready ? null : el('span', { class: 'soon', text: 'soon' })), select];
    }));

    const problem = this.problem();
    this.lobbyNotice.textContent = problem || '';
    this.startButton.disabled = !!problem;
  }

  // Why the match cannot start, if it cannot.
  problem() {
    const map = this.mapInfo();
    const inUse = this.slots.slice(0, this.match.slots).filter((s) => s.kind !== 'closed');
    if (this.match.slots > map.bases) return map.name + ' has room for ' + map.bases + ' players: set the slots to ' + map.bases + ' or fewer, or pick a bigger map.';
    if (inUse.length < 2) return 'A match needs at least two players.';
    const teams = new Set(inUse.map((s) => s.colour));
    if (teams.size < 2) return 'Everyone is on the same team (the same colour): give someone another colour.';
    return null;
  }

  // The map as the radar would show it -- rock, crystals and open ground, each cell twice as
  // wide as it is tall, as the game draws them -- with the base markers in their players'
  // colours.
  drawPreview(map) {
    const c = this.mapPreview;
    const game = this.game;
    const data = game && game.mapData && game.mapData();
    const online = this.player.online.maps && this.player.online.maps[map.id];
    const cells = online ? online.map.split('') : data && data['map' + map.id];
    const num = (ch) => (game && game.ascii2num ? game.ascii2num(ch) : 0);
    const cols = cells ? num(cells[0]) : 30;
    const rows = cells ? num(cells[1]) : 30;
    c.width = cols * 4;
    c.height = rows * 2;
    const g = c.getContext('2d');
    g.fillStyle = '#9a4a20';
    g.fillRect(0, 0, c.width, c.height);
    if (cells && data.tiles) {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const flags = num(data.tiles[num(cells[2 + y * cols + x])]);
          if (flags & 0x20) g.fillStyle = '#3d1c0b';
          else if (flags & 0x10) g.fillStyle = '#b8f060';
          else continue;
          g.fillRect(x * 4, y * 2, 4, 2);
        }
      }
    }
    const bases = (map.info && map.info.bases) || [];
    bases.forEach((b, i) => {
      const slot = this.slots[i];
      g.fillStyle = slot && i < this.match.slots && slot.kind !== 'closed' ? COLOUR_CSS[slot.colour] : '#999';
      g.strokeStyle = '#000';
      g.fillRect((b.x - 1) * 4 - 3, (b.y - 1) * 2 - 3, 8, 6);
      g.strokeRect((b.x - 1) * 4 - 3.5, (b.y - 1) * 2 - 3.5, 9, 7);
    });
  }

  // Remember a preference from the lobby (the player's own faction or colour).
  remember(change) {
    Object.assign(this.settings, change);
    saveSettings(this.settings);
  }

  start() {
    if (this.problem()) return;
    const p = this.panel;
    if (!p || !p.startSkirmish) return;
    this.sound('INT_construction');
    const players = [];
    this.slots.slice(0, this.match.slots).forEach((s, i) => {
      if (s.kind === 'closed') return;
      let faction = s.faction;
      if (faction === 'random') faction = Math.random() < 0.5 ? 'good' : 'evil';
      players.push({
        name: i === 0 ? this.settings.name : 'Computer ' + (i + 1),
        faction,
        colour: s.colour,
        control: i === 0 ? 'local' : 'bot',
        difficulty: s.difficulty,
        base: undefined,
        slot: i,
      });
    });
    const m = this.match;
    // The palette is the host's choice, unless this player prefers one.
    const palette = this.settings.palette === 'all' ? m.palette : this.settings.palette;
    const settings = {
      map: /^\d+$/.test(String(m.map)) ? Number(m.map) : m.map, mode: m.mode, cash: m.cash, units: m.units, prebuilt: m.prebuilt, shroud: m.shroud,
      superweapons: m.superweapons, palette, speed: m.speed, regrowth: m.regrowth, specops: m.specops,
      crates: m.crates, christmas: m.christmas, crateRate: m.crateRate, income: m.income, pizzaCost: m.pizzaCost,
      players,
    };
    // A player's base is the marker their slot is on.
    const bases = (this.mapInfo().info && this.mapInfo().info.bases) || [];
    players.forEach((pl) => { pl.base = bases[pl.slot]; });
    this.settings.lobby = { match: m, slots: this.slots.map(({ kind, faction, colour, difficulty }) => ({ kind, faction, colour, difficulty })) };
    saveSettings(this.settings);
    if (this.hooks.setSpeed) this.hooks.setSpeed(m.speed);
    this.close();
    p.startSkirmish(settings);
  }

  // ---- settings -------------------------------------------------------------------------------
  buildSettings() {
    this.settingsBody = el('div', { class: 'body form' });
    const s = el('section', { class: 'screen settings' },
      el('div', { class: 'titlebar' }, el('h1', { text: 'Settings' })),
      el('div', { class: 'panel settings-panel' }, el('h2', { text: 'You' }), this.settingsBody),
      el('div', { class: 'actions', style: 'width:min(560px,100%)' },
        el('button', { class: 'btn', onclick: () => { this.sound('INT_cursor_select'); this.show('main'); } }, 'Back')));
    this.screens.settings = s;
    this.root.append(s);
  }

  renderSettings() {
    const st = this.settings;
    const save = () => { saveSettings(st); this.applyVolumes(); };
    const name = el('input', { type: 'text', maxlength: 16, value: st.name, 'aria-label': 'Name', oninput: (e) => { st.name = e.target.value.trim() || 'Player'; save(); } });
    const faction = el('select', { 'aria-label': 'Faction', onchange: (e) => { st.faction = e.target.value; this.slots[0].faction = st.faction; save(); } },
      el('option', { value: 'good', text: 'Astro', selected: st.faction === 'good' }),
      el('option', { value: 'evil', text: 'Alien', selected: st.faction === 'evil' }));
    const colours = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' },
      ...COLOURS.map((c) => el('span', { class: 'swatch' + (st.colour === c ? ' on' : ''), role: 'radio', 'aria-checked': st.colour === c ? 'true' : 'false', tabindex: 0, title: c, style: 'background:' + COLOUR_CSS[c],
        onclick: () => { st.colour = c; this.slots[0].colour = c; save(); this.sound('INT_cursor_select'); this.renderSettings(); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); } } })));
    const palette = el('select', { 'aria-label': 'Map palette', onchange: (e) => { st.palette = e.target.value; save(); } },
      el('option', { value: 'all', text: 'As the host chooses', selected: st.palette === 'all' }),
      el('option', { value: 'mars', text: 'Always Mars', selected: st.palette === 'mars' }),
      el('option', { value: 'snowy', text: 'Always Snowy', selected: st.palette === 'snowy' }));
    const slider = (key) => el('input', { type: 'range', min: 0, max: 100, value: Math.round(st[key] * 100), 'aria-label': key,
      oninput: (e) => { st[key] = Number(e.target.value) / 100; save(); },
      onchange: () => { if (key !== 'music') this.sound(key === 'ui' ? 'INT_cursor_select' : 'INT_collect'); } });
    this.settingsBody.replaceChildren(
      el('label', { text: 'Name' }), name,
      el('label', { text: 'Faction' }), faction,
      el('label', { text: 'Colour' }), colours,
      el('label', { text: 'Map palette' }), palette,
      el('label', { text: 'Music' }), slider('music'),
      el('label', { text: 'Sound' }), slider('sound'),
      el('label', { text: 'Interface' }), slider('ui'),
      el('label', { class: 'wide', text: 'An offline client, for Windows, Mac and Linux, is coming.' }));
  }

  applyVolumes() {
    const snd = this.player.sound;
    if (snd && snd.setVolumes) snd.setVolumes({ music: this.settings.music, sound: this.settings.sound, ui: this.settings.ui });
  }
}
