// The online version's menus, in HTML over the game: the main menu, the skirmish lobby, online
// play (the list of games, a room's lobby: see net.js for the match itself) and the settings.  The game's own menus are still there for the story (STORY), and the game
// comes back here when a match or a story game ends (Online.menu, called from game.js).

import { COLOURS, COLOUR_CSS, DEFAULTS, PALETTES, UI_SCALES, loadSettings, saveSettings } from './settings.js';
import { american } from './spelling.js';

const FACTIONS = { good: 'Astro', evil: 'Alien', random: 'Random', spectate: 'Spectator' };
const DIFFICULTIES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const SHARE = [['off', 'Off'], ['humans', 'Human control only'], ['all', 'All']];

// The match settings, with the choices the lobby offers.  `ready` says whether the game does
// anything with a setting yet; the rest are shown, and marked as coming.  `when` says which
// other settings a setting depends on (the pizza's cost is only for Pizza Mode).  `group` is the
// part of the Match panel it is shown in (MATCH_GROUPS).
const MATCH = [
  { key: 'mode', group: 'Game', label: 'Game mode', ready: true, choices: [['all', 'Destroy all'], ['structures', 'Destroy structures'], ['hq', 'Destroy HQs'], ['pizza', 'Pizza mode'], ['ctf', 'Capture the flag'], ['hero', 'Hunt the Hero']] },
  { key: 'cash', group: 'Start', label: 'Starting money', ready: true, choices: [[2500, '$2,500'], [5000, '$5,000'], [7500, '$7,500'], [10000, '$10,000'], [15000, '$15,000'], [20000, '$20,000'], [30000, '$30,000'], [50000, '$50,000']] },
  { key: 'units', group: 'Start', label: 'Starting units', ready: true, choices: [[0, 'None'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']] },
  { key: 'prebuilt', group: 'Start', label: 'Base', ready: true, choices: [[false, 'HQ only'], [true, 'HQ, power, barracks']] },
  { key: 'specops', group: 'Special Ops', label: 'Special Ops', ready: true, choices: [['on', 'On'], ['tech', 'Need the tech centre'], ['off', 'Off']] },
  { key: 'opsHQ', group: 'Special Ops', label: 'Ops Ship and Hive', ready: true, when: (m) => m.specops !== 'off', choices: [[true, 'Headquarters too'], [false, 'As in the story']] },
  { key: 'crates', group: 'Crates', label: 'Crates', ready: true, choices: [[true, 'On'], [false, 'Off']] },
  { key: 'christmas', group: 'Crates', label: 'Christmas crate', ready: true, choices: [[true, 'On'], [false, 'Off']], when: (m) => m.crates },
  { key: 'crateRate', group: 'Crates', label: 'Crates appear', ready: true, choices: [['rare', 'Rarely'], ['normal', 'Normally'], ['often', 'Often']], when: (m) => m.crates },
  { key: 'income', group: 'Economy', label: 'Passive income', ready: true, choices: [[0, 'None'], [200, '$200 a minute'], [400, '$400 a minute'], [800, '$800 a minute']] },
  { key: 'pizzaCost', group: 'Game', label: 'Pizza cost', ready: true, when: (m) => m.mode === 'pizza', choices: [[25000, '$25,000'], [50000, '$50,000'], [100000, '$100,000']] },
  { key: 'captures', group: 'Game', label: 'Capture limit', ready: true, when: (m) => m.mode === 'ctf', choices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [n, n === 1 ? 'Once: out' : n + ' times']) },
  { key: 'speed', group: 'Production and speed', label: 'Unit speed', ready: true, choices: [[0.75, 'Slow'], [1, 'Normal'], [1.25, 'Fast'], [1.5, 'Faster'], [2, 'Fastest']] },
  { key: 'balance', group: 'Combat', label: 'Balance', ready: true, choices: [['vanilla', 'Vanilla'], ['conquer', 'Conquerer']] },
  { key: 'build', group: 'Production and speed', label: 'Build speed', ready: true, choices: [[0.5, 'Slow'], [1, 'Normal'], [2, 'Fast'], [3, 'Faster'], [10, 'Quickbuild (ten times)']] },
  { key: 'queue', group: 'Production and speed', label: 'Unit queue', ready: true, choices: [[false, 'Off'], [true, "Up to each unit's maximum"]] },
  { key: 'shields', group: 'Combat', label: 'Triple shields', ready: true, choices: [[false, 'Off'], [true, 'On, for everyone']] },
  { key: 'shroud', group: 'Map', label: 'Shroud', ready: true, choices: [[true, 'On'], [false, 'Off']] },
  { key: 'superweapons', group: 'Combat', label: 'Superweapons', ready: true, choices: [[true, 'On'], [false, 'Off']] },
  { key: 'factions', group: 'Game', label: 'Factions', ready: true, choices: [['all', 'Astro and Alien'], ['good', 'Astro only'], ['evil', 'Alien only'], ['random', 'All random']] },
  // What allies (players of one colour) share: between people only, or computer players too.
  { key: 'shareMoney', group: 'Allies', label: 'Allies share money', ready: true, choices: SHARE },
  { key: 'sharePower', group: 'Allies', label: 'Allies share energy (and radar)', ready: true, choices: SHARE },
  { key: 'shareUnits', group: 'Allies', label: 'Allies share units', ready: true, choices: SHARE },
  { key: 'shareBuildings', group: 'Allies', label: 'Allies share buildings', ready: true, choices: SHARE },
  { key: 'regrowth', group: 'Economy', label: 'Crystal regrowth', ready: true, choices: [[0, 'None'], [0.5, 'Slow'], [1, 'Normal'], [2, 'Fast']] },
  { key: 'palette', group: 'Map', label: 'Map palette', ready: true, choices: [...PALETTES, ['random', 'Random']] },
];

// The Match panel's parts, in this order, each under a thin line; within one, its settings in
// alphabetical order.  (Both panels, the skirmish's and a room's.)  The parts stand side by side,
// as many across as the window has room for (.match-groups), so a wider window shows them all.
const MATCH_GROUPS = ['Game', 'Combat', 'Start', 'Economy', 'Production and speed', 'Special Ops', 'Crates', 'Allies', 'Map'];
function matchGroups(row) {
  return MATCH_GROUPS.map((group) => el('div', { class: 'group' }, el('div', { class: 'section', text: group }),
    el('div', { class: 'form' }, ...MATCH.filter((m) => m.group === group).sort((a, b) => a.label.localeCompare(b.label)).flatMap(row))));
}

// The games list, refreshed by itself this often (seconds) while it is shown and the page seen.
const ROOM_REFRESH_S = 10;
const MODE_NAMES = { all: 'Destroy all', structures: 'Destroy structures', hq: 'Destroy HQs', pizza: 'Pizza mode', ctf: 'Capture the flag', hero: 'Hunt the Hero' };

const MATCH_DEFAULTS = {
  map: 10, slots: 2, mode: 'all', cash: 10000, units: 3, prebuilt: false, specops: 'on', opsHQ: true, crates: true, balance: 'vanilla',
  christmas: false, crateRate: 'normal', income: 0, pizzaCost: 50000, speed: 1, shroud: true,
  superweapons: true, factions: 'all', regrowth: 1, palette: 'mars', build: 1, queue: false, shields: false, captures: 1,
  shareMoney: 'off', sharePower: 'off', shareUnits: 'off', shareBuildings: 'off',
};

// The palette a match is seen in: the host's, unless this player prefers one; either may be
// Random: any of them for the match (the host's the same for everyone, by the match's seed: the
// palette changes only how the map looks).
function paletteFor(host, mine, seed) {
  const pick = (p, n) => (p === 'random' ? PALETTES[n % PALETTES.length][0] : p);
  if (mine && mine !== 'all') return pick(mine, Math.floor(Math.random() * PALETTES.length));
  return pick(host || 'mars', seed === undefined ? Math.floor(Math.random() * PALETTES.length) : Math.abs(Math.trunc(seed)));
}

// Which base marker each player starts on (players given by colour, their team): the
// assignment that keeps the nearest two enemies furthest apart, then enemies apart overall,
// then allies together.  Undefined if there are fewer markers than players.
function spreadBases(bases, teams) {
  const n = teams.length;
  if (!bases || bases.length < n) return undefined;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let best = null, bestScore = null;
  const pick = [], used = new Array(bases.length).fill(false);
  const score = () => {
    let near = Infinity, apart = 0, together = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = dist(bases[pick[i]], bases[pick[j]]);
        if (teams[i] === teams[j]) together += d;
        else { near = Math.min(near, d); apart += d; }
      }
    }
    return [near, apart, -together];
  };
  const better = (a, b) => { for (let k = 0; k < a.length; k++) { if (Math.abs(a[k] - b[k]) > 1e-9) return a[k] > b[k]; } return false; };
  const walk = (i) => {
    if (i === n) {
      const s = score();
      if (!bestScore || better(s, bestScore)) { bestScore = s; best = pick.slice(); }
      return;
    }
    for (let b = 0; b < bases.length; b++) {
      if (used[b]) continue;
      used[b] = true; pick[i] = b;
      walk(i + 1);
      used[b] = false;
    }
  };
  walk(0);
  return best && best.map((b) => bases[b]);
}

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
    this.net = this.hooks.net || null;   // online play (net.js)
    this.chatLines = [];
    this.buildMain();
    this.buildLobby();
    this.buildOnline();
    this.buildRoom();
    this.buildSettings();
    this.applyVolumes();
    this.applyPrefs();
    this.watchSpelling();
    this.wireNet();
    // The app: an update fetched is installed on quitting.
    if (window.crystalienApp) window.crystalienApp.onUpdateReady((v) => this.toast('Version ' + v + ' of the app is ready: it installs when you close the app.'));
    // The game calls Online.menu() when a match or a story game is over: back to the room, for
    // a match over the network.
    player.online.menu = (screen) => {
      // (Screensaver Mode: a match over, the next -- until it is quit, to the main menu)
      if (this.screensaver) {
        if (screen === 'lobby') {
          setTimeout(() => { if (this.screensaver) this.startScreensaver(); }, 0);
          return;
        }
        this.screensaver = false;
      }
      if (screen === 'lobby' && this.net && this.net.code) {
        this.net.ended();
        this.open('room');
        return;
      }
      this.open(screen);
    };
    this.buildIngame();
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
      this.showIngame(this.paused());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // The game is loaded: show the main menu over it.
  attach() {
    if (this.attached) return;
    this.attached = true;
    if (this.panel) this.panel.state = 'hidden';
    // A link to a room (?join=CODE): straight to it.  (Read first: the menus set the address.)
    const join = new URLSearchParams(location.search).get('join');
    this.open('main');
    if (join && this.net) {
      this.show('online');
      this.joinRoom(join.toUpperCase());
    }
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
    // The address is the room's link while this page is in one (to share, or to come back to),
    // and the site's own again once it leaves.
    this.showAddress(name === 'room' && this.net && this.net.code);
    if (name === 'lobby') this.renderLobby();
    if (name === 'settings') this.renderSettings();
    // (the list of games kept current while it is looked at: roomTick)
    clearInterval(this.roomTimer);
    if (name === 'online') {
      this.refreshRooms();
      this.roomTimer = setInterval(() => this.roomTick(), 1000);
    }
    if (name === 'room') this.renderRoom();
    // (for the keys: the screen's first control -- not a text box, and nothing on a touch screen,
    // where focusing one brings up the keyboard)
    const touch = this.player.online.touch || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const first = !touch && this.screens[name] && this.screens[name].querySelector('button:not(:disabled), select, input:not([type=text])');
    if (first) first.focus({ preventScroll: true });
  }

  story() {
    // (at the game's own speed: a skirmish, or the Screensaver, may have left it faster or slower)
    if (this.hooks.setSpeed) this.hooks.setSpeed(1);
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
        el('button', { class: 'btn', disabled: !this.net, onclick: go(() => this.show('online')) }, 'Online'),
        el('button', { class: 'btn', onclick: go(() => this.story()) }, 'Story'),
        el('button', { class: 'btn', onclick: go(() => this.startScreensaver()) }, 'Screensaver Mode'),
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
    for (let i = 0; i < 7; i++) {
      const s = saved && saved[i];
      if (i === 0) {
        slots.push({ kind: 'you', name: me.name, faction: s && s.faction === 'spectate' ? 'spectate' : me.faction, colour: me.colour });
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
    // (seven, for six players and this one watching)
    for (let n = 2; n <= 7; n++) this.slotCount.append(el('option', { value: n, text: n + ' slots' }));
    this.mapPreview = el('canvas', { width: 64, height: 64 });
    this.mapName = el('div', { class: 'name' });
    this.mapPlayers = el('div', { class: 'players' });
    this.slotList = el('div', { class: 'slots' });
    this.lobbyNotice = el('div', { class: 'notice' });
    this.matchForm = el('div', { class: 'match-groups' });
    this.startButton = el('button', { class: 'btn small primary', onclick: () => this.start() }, 'Start');
    // Open to others: this lobby, its settings and computer players, becomes a room on the
    // server (as Online's Host does), for people to join by the list, a password, or the link.
    this.lobbyAccess = el('select', { 'aria-label': 'Who can join', onchange: () => this.renderLobbyAccess() },
      el('option', { value: 'offline', text: 'Just me (offline)' }),
      el('option', { value: 'public', text: 'Anyone (listed)' }),
      el('option', { value: 'password', text: 'With a password (listed)' }),
      el('option', { value: 'invite', text: 'Only with the code or link' }));
    this.lobbyPassword = el('input', { type: 'text', maxlength: 32, placeholder: 'Password', 'aria-label': 'Password', disabled: true });
    this.lobbyHostButton = el('button', { class: 'btn small', disabled: true, onclick: () => this.hostLobby() }, 'Host');
    this.lobbyHostNote = el('div', { class: 'footnote' });
    const s = el('section', { class: 'screen lobby' },
      el('div', { class: 'titlebar' }, el('h1', { text: 'Skirmish' }), el('div', { class: 'spacer' }),
        el('button', { class: 'btn small', onclick: () => { this.sound('INT_cursor_select'); this.show('main'); } }, 'Back'),
        this.startButton),
      // (laid out as a room is: the players, beside them playing with others, the match below)
      el('div', { class: 'room-grid' },
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
        el('div', { class: 'panel' }, el('h2', { text: 'Play with others' }),
          el('div', { class: 'body' },
            el('div', { class: 'form' },
              el('label', { text: 'Who can join' }), this.lobbyAccess,
              el('label', { text: 'Password' }), this.lobbyPassword),
            el('div', { class: 'actions' }, this.lobbyHostButton),
            this.lobbyHostNote)),
        el('div', { class: 'panel wide' }, el('h2', { text: 'Match' }), el('div', { class: 'body' }, this.matchForm,
          el('div', { class: 'actions' }, el('button', { class: 'btn small', onclick: () => this.resetMatch() }, 'Reset all to default'))))));
    this.screens.lobby = s;
    this.root.append(s);
  }

  renderLobbyAccess() {
    const access = this.lobbyAccess.value;
    this.lobbyPassword.disabled = access !== 'password';
    this.lobbyHostButton.disabled = access === 'offline' || !this.net;
    this.lobbyHostNote.textContent = !this.net ? 'Playing with others needs the server, which this page cannot reach.'
      : access === 'offline' ? 'Start plays here, against the computer.'
      : 'Host makes this a game others can join, with these settings and computer players.';
  }

  // The skirmish lobby, opened to others: a room made with its settings, slots and computer
  // players.  (If no slot would be open for someone to come in, the first after this player's is.)
  async hostLobby() {
    const access = this.lobbyAccess.value;
    const password = access === 'password' ? this.lobbyPassword.value : undefined;
    if (access === 'password' && !password) {
      this.lobbyHostNote.textContent = 'Choose a password for the game first.';
      return;
    }
    const ok = await this.hostWith(access, password, (msg) => { this.lobbyHostNote.textContent = msg; });
    if (!ok) return;
    const count = Math.min(this.match.slots, 6);
    const slots = this.slots.slice(0, count);
    let open = false;
    slots.forEach((slot, i) => {
      if (i === 0) {
        if (slot.faction === 'spectate') this.net.spectate();
        else this.net.setSlot(0, { faction: slot.faction, colour: slot.colour });
        return;
      }
      if (slot.kind === 'bot') this.net.setSlot(i, { kind: 'bot', faction: slot.faction, colour: slot.colour, difficulty: slot.difficulty });
      else if (slot.kind === 'closed') this.net.setSlot(i, { kind: 'closed' });
      else open = true;
    });
    if (!open && count > 1) this.net.setSlot(1, { kind: 'open' });
    this.show('room');
  }

  renderLobby() {
    this.renderLobbyAccess();
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
    const spectating = (slot) => slot.kind === 'you' && slot.faction === 'spectate';
    const rows = [];
    // (a slot beyond the map's bases is marked: counting only those that play)
    let playing = 0;
    for (let i = 0; i < this.match.slots; i++) {
      const slot = this.slots[i];
      if (!factionChoices.includes(slot.faction) && !(i === 0 && slot.faction === 'spectate')) slot.faction = factionChoices[0];
      const plays = slot.kind !== 'closed' && !spectating(slot);
      if (plays) playing++;
      const over = plays && playing > map.bases;
      const kind = i === 0
        ? el('div', { class: 'who' }, el('span', { class: 'name', text: slot.name }))
        : el('select', { 'aria-label': 'Slot ' + (i + 1), onchange: (e) => { slot.kind = e.target.value; this.renderLobby(); } },
          el('option', { value: 'bot', text: 'Computer', selected: slot.kind === 'bot' }),
          el('option', { value: 'closed', text: 'Closed', selected: slot.kind === 'closed' }));
      const out = slot.kind === 'closed';
      const choices = i === 0 ? [...factionChoices, 'spectate'] : factionChoices;
      const faction = el('select', { 'aria-label': 'Faction', disabled: out, onchange: (e) => { slot.faction = e.target.value; if (i === 0 && slot.faction !== 'spectate') this.remember({ faction: slot.faction }); this.renderLobby(); } },
        ...choices.map((f) => el('option', { value: f, text: FACTIONS[f], selected: slot.faction === f })));
      const colour = el('select', { 'aria-label': 'Colour', disabled: out || spectating(slot), onchange: (e) => { slot.colour = e.target.value; if (i === 0) this.remember({ colour: slot.colour }); this.renderLobby(); } },
        ...COLOURS.map((c) => el('option', { value: c, text: c[0].toUpperCase() + c.slice(1), selected: slot.colour === c })));
      const extra = i === 0
        ? el('div', { class: 'who', text: 'You' })
        : el('select', { 'aria-label': 'Difficulty', disabled: slot.kind !== 'bot', onchange: (e) => { slot.difficulty = e.target.value; } },
          ...Object.entries(DIFFICULTIES).map(([k, v]) => el('option', { value: k, text: v, selected: slot.difficulty === k })));
      rows.push(el('div', { class: 'slot' + (out ? ' closed' : '') + (over ? ' over' : '') },
        el('div', { class: 'num' }, el('span', { class: 'swatch', style: 'background:' + (spectating(slot) ? '#8a8a8a' : COLOUR_CSS[slot.colour]), title: spectating(slot) ? 'spectator' : slot.colour })),
        kind, faction, colour, extra));
    }
    this.slotList.replaceChildren(...rows);

    this.matchForm.replaceChildren(...matchGroups((m) => {
      const select = el('select', { 'aria-label': m.label, disabled: !m.ready || (m.when && !m.when(this.match)), onchange: (e) => {
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

  // The Match panel's settings as they are at first (the map and the players' slots stay).
  resetMatch() {
    for (const m of MATCH) this.match[m.key] = MATCH_DEFAULTS[m.key];
    this.sound('INT_cursor_select');
    this.renderLobby();
  }

  // Why the match cannot start, if it cannot.
  problem() {
    const map = this.mapInfo();
    const inUse = this.slots.slice(0, this.match.slots).filter((s) => s.kind !== 'closed' && s.faction !== 'spectate');
    if (inUse.length > map.bases) return map.name + ' has room for ' + map.bases + ' players: close a slot, or pick a bigger map.';
    if (inUse.length < 2) return 'A match needs at least two players.';
    const teams = new Set(inUse.map((s) => s.colour));
    if (teams.size < 2) return 'Everyone is on the same team (the same colour): give someone another colour.';
    return null;
  }

  // The map as the radar would show it -- rock, crystals and open ground, each cell twice as
  // wide as it is tall, as the game draws them -- with the base markers in their players'
  // colours.
  drawPreview(map, canvas, slots, count) {
    const c = canvas || this.mapPreview;
    slots = slots || this.slots;
    count = count === undefined ? this.match.slots : count;
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
      // (A converted map's flat hill tops are rock all the same.)
      g.fillStyle = '#3d1c0b';
      for (const [start, length] of (online && online.solid) || []) {
        for (let i = start; i < start + length; i++) g.fillRect((i % cols) * 4, Math.floor(i / cols) * 2, 4, 2);
      }
    }
    const bases = (map.info && map.info.bases) || [];
    bases.forEach((b, i) => {
      const slot = slots[i];
      g.fillStyle = slot && i < count && slot.kind !== 'closed' && slot.kind !== 'open' && slot.colour ? COLOUR_CSS[slot.colour] : '#999';
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
    const m = this.match;
    const players = [];
    this.slots.slice(0, this.match.slots).forEach((s, i) => {
      if (s.kind === 'closed' || s.faction === 'spectate') return;
      let faction = m.factions === 'random' ? 'random' : s.faction;
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
    // The palette is the host's choice, unless this player prefers one.
    const palette = paletteFor(m.palette, this.settings.palette);
    const settings = {
      map: /^\d+$/.test(String(m.map)) ? Number(m.map) : m.map, mode: m.mode, cash: m.cash, units: m.units, prebuilt: m.prebuilt, shroud: m.shroud,
      superweapons: m.superweapons, palette, speed: m.speed, regrowth: m.regrowth, specops: m.specops, opsHQ: m.opsHQ !== false, balance: m.balance || 'vanilla',
      crates: m.crates, christmas: m.christmas, crateRate: m.crateRate, income: m.income, pizzaCost: m.pizzaCost,
      build: m.build || 1, queue: !!m.queue, shields: !!m.shields, captures: m.captures || 1,
      shareMoney: m.shareMoney, sharePower: m.sharePower, shareUnits: m.shareUnits, shareBuildings: m.shareBuildings,
      players,
    };
    // Watching: a grey sidebar, with nothing on it to build.
    if (this.slots[0].faction === 'spectate') settings.spectator = { name: this.settings.name, faction: 'good' };
    // Bases: of the map's markers, those that keep enemies furthest apart (allies near each
    // other, all else equal).
    const bases = (this.mapInfo().info && this.mapInfo().info.bases) || [];
    const chosen = spreadBases(bases, players.map((pl) => pl.colour));
    players.forEach((pl, i) => { pl.base = chosen ? chosen[i] : bases[pl.slot]; });
    this.settings.lobby = { match: m, slots: this.slots.map(({ kind, faction, colour, difficulty }) => ({ kind, faction, colour, difficulty })) };
    saveSettings(this.settings);
    if (this.hooks.setSpeed) this.hooks.setSpeed(m.speed);
    this.close();
    p.startSkirmish(settings);
  }


  // ---- Screensaver Mode ---------------------------------------------------------------------------
  // A match of computer players to watch, everything about it by chance -- the map, how many
  // play (as many as it has room for) and in which colours, one team each, the mode and its
  // rules, the palette (unless this player prefers one: the settings' Map palette) -- and when
  // it is over, another (Online.menu), until the player quits it from the pause menu.  The
  // Skirmish lobby's settings are its own: nothing here is kept.
  startScreensaver() {
    const p = this.panel;
    if (!p || !p.startSkirmish) return;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const shuffled = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
    const choice = (key, keep) => pick(MATCH.find((m) => m.key === key).choices.map(([v]) => v).filter(keep || (() => true)));
    const map = pick(this.maps().filter((m) => m.bases >= 2));
    const count = 2 + Math.floor(Math.random() * (map.bases - 1));
    const colours = shuffled(COLOURS).slice(0, count);
    const players = colours.map((colour, i) => ({ name: 'Computer ' + (i + 1), faction: Math.random() < 0.5 ? 'good' : 'evil', colour,
      control: 'bot', difficulty: pick(['medium', 'hard']), base: undefined, slot: i }));
    const crates = choice('crates');
    const settings = {
      map: /^\d+$/.test(map.id) ? Number(map.id) : map.id, mode: choice('mode'), cash: choice('cash'), units: choice('units'), prebuilt: choice('prebuilt'),
      shroud: false, superweapons: choice('superweapons'), palette: paletteFor(pick(['mars', 'snowy', 'hive', 'lb-mars-fw']), this.settings.palette),
      // (never a match without crystals growing back: it could stand still for good)
      speed: choice('speed'), regrowth: choice('regrowth', (v) => v > 0), specops: choice('specops'), opsHQ: choice('opsHQ'), balance: choice('balance'),
      crates, christmas: crates && choice('christmas'), crateRate: choice('crateRate'), income: choice('income'), pizzaCost: choice('pizzaCost'),
      build: choice('build'), queue: choice('queue'), shields: choice('shields'), captures: choice('captures', (n) => n <= 5),
      shareMoney: 'off', sharePower: 'off', shareUnits: 'off', shareBuildings: 'off',
      players, spectator: { name: this.settings.name, faction: 'good' }, screensaver: true,
    };
    const bases = (map.info && map.info.bases) || [];
    const chosen = spreadBases(bases, colours);
    players.forEach((pl, i) => { pl.base = chosen ? chosen[i] : bases[i]; });
    this.screensaver = true;
    if (this.hooks.setSpeed) this.hooks.setSpeed(settings.speed);
    this.close();
    p.startSkirmish(settings);
  }

  // ---- the options in a match: the settings a match can take, beside the pause menu --------------
  // What the game draws and how it is controlled, and the sound: nothing the match itself runs
  // on, and not who this player is (name, faction, colour) or the palette, which a match takes
  // as it starts.  The Screensaver's own, in Screensaver Mode.
  buildIngame() {
    this.ingameBody = el('div', { class: 'body form' });
    this.ingame = el('div', { class: 'panel ingame', role: 'dialog', 'aria-label': 'Options' }, el('h2', { text: 'Options' }), this.ingameBody);
    // (its clicks and keys are its own, not the game's under it)
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'wheel', 'keydown', 'keyup']) this.ingame.addEventListener(type, (e) => e.stopPropagation());
    document.body.append(this.ingame);
  }

  // The game's pause menu is up: a match (or the story) under way, and stopped -- or, over the
  // network, where the game goes on, this player's controls stopped.
  paused() {
    const game = this.panel && this.panel.game;
    const level = game && game.level;
    if (!game || !level || this.root.classList.contains('shown')) return false;
    return game.active === false || !!(level.control && level.control.active === false);
  }

  showIngame(shown) {
    if (shown === this.ingameShown) return;
    this.ingameShown = shown;
    if (shown) {
      this.ingameBody.replaceChildren(...this.settingsRows(true));
      this.respell();
    }
    this.ingame.classList.toggle('shown', shown);
  }

  // ---- online: the list of games ---------------------------------------------------------------
  buildOnline() {
    this.roomList = el('div', { class: 'rooms' });
    this.onlineNotice = el('div', { class: 'notice' });
    this.refreshNote = el('div', { class: 'footnote' });
    this.joinCode = el('input', { type: 'text', maxlength: 6, placeholder: 'ABC123', 'aria-label': 'Room code', class: 'code-input',
      onkeydown: (e) => { if (e.key === 'Enter') this.joinByCode(); } });
    this.hostAccess = el('select', { 'aria-label': 'Who can join', onchange: () => { this.hostPassword.disabled = this.hostAccess.value !== 'password'; } },
      el('option', { value: 'public', text: 'Anyone (listed)' }),
      el('option', { value: 'password', text: 'With a password (listed)' }),
      el('option', { value: 'invite', text: 'Only with the code or link' }));
    this.hostPassword = el('input', { type: 'text', maxlength: 32, placeholder: 'Password', 'aria-label': 'Password', disabled: true });
    const back = () => { this.sound('INT_cursor_select'); this.show('main'); };
    const s = el('section', { class: 'screen online' },
      el('div', { class: 'titlebar' }, el('h1', { text: 'Online' }), el('div', { class: 'spacer' }),
        el('button', { class: 'btn small', onclick: back }, 'Back'),
        el('button', { class: 'btn small', onclick: () => this.refreshRooms() }, 'Refresh')),
      el('div', { class: 'online-grid' },
        el('div', { class: 'panel' }, el('h2', { text: 'Games' }), el('div', { class: 'body' }, this.roomList, this.onlineNotice, this.refreshNote)),
        el('div', { class: 'side' },
          el('div', { class: 'panel' }, el('h2', { text: 'Host a game' }),
            el('div', { class: 'body form' },
              el('label', { text: 'Who can join' }), this.hostAccess,
              el('label', { text: 'Password' }), this.hostPassword,
              el('div', { class: 'wide right' }, el('button', { class: 'btn small primary', onclick: () => this.host() }, 'Host')))),
          el('div', { class: 'panel' }, el('h2', { text: 'Join by code' }),
            el('div', { class: 'body join' }, this.joinCode, el('button', { class: 'btn small', onclick: () => this.joinByCode() }, 'Join'))))));
    this.screens.online = s;
    this.root.append(s);
  }

  // Each second while the games list is shown: its countdown, and at nought a refresh.  Paused
  // while the page is not seen (another tab, the window covered); seen again after the list
  // would have been refreshed, at once.
  roomTick() {
    if (!this.screens.online.classList.contains('active')) {
      clearInterval(this.roomTimer);
      return;
    }
    if (document.hidden) {
      if (!this.roomHiddenAt) this.roomHiddenAt = Date.now();
      return;
    }
    if (this.roomHiddenAt) {
      const away = Date.now() - this.roomHiddenAt;
      this.roomHiddenAt = 0;
      if (away >= ROOM_REFRESH_S * 1000) {
        this.refreshRooms(true);
        return;
      }
    }
    this.roomCountdown = (this.roomCountdown || ROOM_REFRESH_S) - 1;
    if (this.roomCountdown <= 0) this.refreshRooms(true);
    else this.showCountdown();
  }

  showCountdown() {
    this.refreshNote.textContent = this.net ? 'Refreshing in ' + this.roomCountdown + ' s' : '';
  }

  // (quiet: the list refreshed by itself, without "Looking for games..." each time)
  async refreshRooms(quiet) {
    if (!this.net) return;
    this.roomCountdown = ROOM_REFRESH_S;
    this.showCountdown();
    const mine = (this.refreshes = (this.refreshes || 0) + 1);
    if (!quiet) this.onlineNotice.textContent = 'Looking for games...';
    let rooms;
    try {
      rooms = await this.net.list();
    } catch (e) {
      if (mine !== this.refreshes) return;
      this.roomList.replaceChildren();
      this.onlineNotice.textContent = "Can't reach the server (" + e.message + '). Try again in a moment.';
      return;
    }
    if (mine !== this.refreshes) return;
    this.onlineNotice.textContent = rooms.length ? '' : 'No games right now: host one!';
    const maps = Object.fromEntries(this.maps().map((m) => [m.id, m.name]));
    this.pings = this.pings || {};
    this.roomList.replaceChildren(...rooms.map((r) => {
      const ping = el('span', { class: 'ping', text: this.pings[r.code] ? this.pings[r.code] + 'ms' : '...' });
      const label = (r.host || 'Someone') + ' - ' + (MODE_NAMES[r.mode] || r.mode) + ' - ' + (maps[String(r.map)] || 'Eclipse');
      const row = el('div', { class: 'roomrow' + (r.phase === 'playing' ? ' playing' : '') },
        el('span', { class: 'lock', title: r.access === 'password' ? 'Needs a password' : '', text: r.access === 'password' ? '\u{1F512}' : '' }),
        el('span', { class: 'label nospell', text: label }),
        el('span', { class: 'count', text: r.players + '/' + r.slots }),
        ping,
        el('span', { class: 'phase', text: r.phase === 'playing' ? 'Playing' : 'In lobby' }),
        el('button', { class: 'btn small', onclick: () => this.joinRoom(r.code, r.access) }, r.phase === 'playing' ? 'Watch' : 'Join'));
      // (a room that says it is gone -- its server restarted, say -- is taken off the list)
      this.net.ping(r.code).then((ms) => {
        if (ms !== null) {
          this.pings[r.code] = ms;
          ping.textContent = ms + 'ms';
          return;
        }
        row.remove();
        if (mine === this.refreshes && !this.roomList.children.length) this.onlineNotice.textContent = 'No games right now: host one!';
      }, () => { ping.textContent = '?'; });
      return row;
    }));
  }

  who(password) {
    const st = this.settings;
    return { name: st.name, password, faction: st.faction === 'random' ? 'random' : st.faction, colour: st.colour };
  }

  async joinRoom(code, access) {
    if (!this.net) return;
    this.sound('INT_cursor_select');
    let password;
    if (access === 'password') {
      password = prompt('The password for this game:');
      if (password === null) return;
    }
    this.onlineNotice.textContent = 'Joining ' + code + '...';
    try {
      await this.net.join(code, this.who(password));
    } catch (e) {
      if (e.message === 'password' && access !== 'password') return this.joinRoom(code, 'password');
      const why = { password: 'That is not the password.', full: 'That game is full.', kicked: 'The host asked you to leave that game.' }[e.message];
      this.onlineNotice.textContent = why || ("Couldn't join " + code + ' (' + e.message + ').');
      return;
    }
    this.chatLines = [];
    this.show('room');
  }

  joinByCode() {
    const code = this.joinCode.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      this.onlineNotice.textContent = 'A game\u2019s code is six letters and numbers.';
      return;
    }
    this.joinRoom(code);
  }

  async host() {
    if (!this.net) return;
    this.sound('INT_cursor_select');
    const access = this.hostAccess.value;
    const password = access === 'password' ? this.hostPassword.value : undefined;
    if (access === 'password' && !password) {
      this.onlineNotice.textContent = 'Choose a password for the game first.';
      return;
    }
    if (await this.hostWith(access, password, (msg) => { this.onlineNotice.textContent = msg; })) this.show('room');
  }

  // A room made on the server, and this page in it, with this player's last lobby's settings.
  async hostWith(access, password, say) {
    say('Making a game...');
    try {
      const code = await this.net.create({ access, password, name: this.settings.name + "'s game" });
      await this.net.join(code, this.who(password));
    } catch (e) {
      say("Couldn't make a game (" + e.message + ').');
      return false;
    }
    const m = Object.assign({}, this.match);
    this.net.setMatch(m);
    this.net.setCount(Math.min(m.slots, 6));
    this.chatLines = [];
    return true;
  }

  // ---- online: a room --------------------------------------------------------------------------
  buildRoom() {
    this.roomTitle = el('h1', { class: 'nospell', text: 'Game' });
    this.roomMapSelect = el('select', { 'aria-label': 'Map', onchange: (e) => this.setRoomMatch({ map: e.target.value }) });
    this.roomSlotCount = el('select', { 'aria-label': 'Slots', onchange: (e) => this.net.setCount(Number(e.target.value)) });
    for (let n = 2; n <= 6; n++) this.roomSlotCount.append(el('option', { value: n, text: n + ' slots' }));
    this.roomPreview = el('canvas', { width: 64, height: 64 });
    this.roomMapName = el('div', { class: 'name' });
    this.roomMapPlayers = el('div', { class: 'players' });
    this.roomSlots = el('div', { class: 'slots' });
    this.roomWatchers = el('div', { class: 'watchers' });
    this.roomNotice = el('div', { class: 'notice' });
    this.roomMatchForm = el('div', { class: 'match-groups' });
    this.roomMatchReset = el('button', { class: 'btn small', onclick: () => this.resetRoomMatch() }, 'Reset all to default');
    this.roomStart = el('button', { class: 'btn small primary', onclick: () => this.startOnline() }, 'Start');
    this.roomCode = el('span', { class: 'code', text: '' });
    this.roomCodeShown = false;
    this.roomAccess = el('select', { 'aria-label': 'Who can join', onchange: () => { this.roomPassword.disabled = this.roomAccess.value !== 'password'; } },
      el('option', { value: 'public', text: 'Anyone (listed)' }),
      el('option', { value: 'password', text: 'With a password (listed)' }),
      el('option', { value: 'invite', text: 'Only with the code or link' }));
    this.roomPassword = el('input', { type: 'text', maxlength: 32, placeholder: 'New password', 'aria-label': 'Password', disabled: true });
    this.roomAccessRow = el('div', { class: 'form access' },
      el('label', { text: 'Who can join' }), this.roomAccess,
      el('label', { text: 'Password' }), this.roomPassword,
      el('div', { class: 'wide right' }, el('button', { class: 'btn small', onclick: () => {
        const a = this.roomAccess.value;
        if (a === 'password' && !this.roomPassword.value) { this.roomNotice.textContent = 'Type a password first.'; return; }
        this.net.setAccess(a, this.roomPassword.value);
        this.roomPassword.value = '';
      } }, 'Change')));
    this.chatLog = el('div', { class: 'chatlog', 'aria-live': 'polite' });
    this.chatInput = el('input', { type: 'text', maxlength: 200, placeholder: 'Say something', 'aria-label': 'Chat',
      onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { this.net.chat(e.target.value); e.target.value = ''; } } });
    const leave = () => { this.sound('INT_cursor_select'); this.net.leave(); this.show('online'); };
    const s = el('section', { class: 'screen lobby room' },
      el('div', { class: 'titlebar' }, this.roomTitle, el('div', { class: 'spacer' }),
        el('button', { class: 'btn small', onclick: leave }, 'Leave'),
        this.roomStart),
      el('div', { class: 'room-grid' },
        el('div', { class: 'panel' }, el('h2', { text: 'Players' }),
          el('div', { class: 'body' },
            el('div', { class: 'mapcard' }, this.roomPreview,
              el('div', { class: 'info' },
                el('div', { class: 'form' },
                  el('label', { text: 'Map' }), this.roomMapSelect,
                  el('label', { text: 'Slots' }), this.roomSlotCount),
                this.roomMapName, this.roomMapPlayers)),
            this.roomSlots,
            this.roomWatchers,
            el('div', { class: 'footnote', text: 'Players of the same colour are one team: allies with separate bases.' }),
            this.roomNotice)),
        el('div', { class: 'panel' }, el('h2', { text: 'Invite' }),
          el('div', { class: 'body invite' },
            el('div', { class: 'coderow' }, el('span', { text: 'Code: ' }), this.roomCode,
              el('button', { class: 'btn small', onclick: () => { this.roomCodeShown = !this.roomCodeShown; this.renderRoom(); } }, 'Show'),
              el('button', { class: 'btn small', onclick: () => this.copyInvite() }, 'Copy link')),
            this.roomAccessRow)),
        el('div', { class: 'panel chatpanel' }, el('h2', { text: 'Chat' }), el('div', { class: 'body chat' }, this.chatLog, this.chatInput)),
        el('div', { class: 'panel wide' }, el('h2', { text: 'Match' }), el('div', { class: 'body' }, this.roomMatchForm,
          el('div', { class: 'actions' }, this.roomMatchReset)))));
    this.screens.room = s;
    this.root.append(s);
  }

  showAddress(code) {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;   // (the app shows none)
    const params = new URLSearchParams(location.search);
    if (code) params.set('join', code);
    else params.delete('join');
    const query = params.toString();
    const want = location.pathname + (query ? '?' + query : '') + location.hash;
    if (want !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', want);
  }

  copyInvite() {
    // (from the app, a link to the website's game)
    const site = location.protocol === 'app:' ? 'https://caconline.viosarcade.xyz/' : location.origin + location.pathname;
    const link = site + '?join=' + this.net.code;
    navigator.clipboard.writeText(link).then(() => { this.roomNotice.textContent = 'The link is copied: ' + link; },
      () => { this.roomNotice.textContent = 'The link: ' + link; });
  }

  // The room's match settings, with anything it lacks from the defaults.
  roomMatch() {
    const r = this.net && this.net.room;
    return Object.assign({}, MATCH_DEFAULTS, r && r.match);
  }

  setRoomMatch(change) {
    if (!this.net.isHost) return;
    this.net.setMatch(Object.assign(this.roomMatch(), change));
  }

  // (the host's: as the lobby's resetMatch)
  resetRoomMatch() {
    const change = {};
    for (const m of MATCH) change[m.key] = MATCH_DEFAULTS[m.key];
    this.sound('INT_cursor_select');
    this.setRoomMatch(change);
  }

  renderRoom() {
    if (this.screens.room.classList.contains('active')) this.showAddress(this.net && this.net.code);
    const net = this.net;
    const r = net && net.room;
    if (!r) return;
    const host = net.isHost;
    const members = Object.fromEntries(r.members.map((m) => [m.id, m]));
    const m = this.roomMatch();
    this.roomTitle.textContent = r.name || 'Game';
    this.roomCode.textContent = this.roomCodeShown ? r.code : '\u2022\u2022\u2022\u2022\u2022\u2022';
    this.roomAccessRow.style.display = host ? '' : 'none';
    if (host && document.activeElement !== this.roomAccess) {
      this.roomAccess.value = r.access;
      this.roomPassword.disabled = r.access !== 'password';
    }
    // map and slots
    const maps = this.maps();
    const groups = { undefined: 'CrystAlien Conflict', cnc: 'Command & Conquer', lego: 'LEGO Battles' };
    const byGroup = {};
    for (const x of maps) (byGroup[x.source] = byGroup[x.source] || []).push(x);
    this.roomMapSelect.replaceChildren(...Object.entries(byGroup).map(([g, list]) => el('optgroup', { label: groups[g] || g },
      ...list.map((x) => el('option', { value: x.id, text: x.name + ' (' + x.bases + ')', selected: x.id === String(m.map) })))));
    this.roomMapSelect.disabled = !host;
    this.roomSlotCount.disabled = !host;
    this.roomSlotCount.value = String(r.count);
    const map = maps.find((x) => x.id === String(m.map)) || maps[0];
    this.roomMapName.textContent = map.name;
    this.roomMapPlayers.textContent = map.bases + ' players';
    this.drawPreview(map, this.roomPreview, r.slots, r.count);
    const factionChoices = m.factions === 'all' ? ['good', 'evil', 'random'] : [m.factions];
    const mySlot = r.slots.findIndex((x) => x.kind === 'member' && x.member === net.you);
    const rows = [];
    let playing = 0;
    for (let i = 0; i < r.count; i++) {
      const slot = r.slots[i];
      if (slot.kind === 'member' || slot.kind === 'bot') playing++;
      const over = (slot.kind === 'member' || slot.kind === 'bot') && playing > map.bases;
      const mine = i === mySlot;
      const person = slot.kind === 'member' ? members[slot.member] : null;
      let who;
      if (slot.kind === 'member') {
        who = el('div', { class: 'who' }, el('span', { class: 'name', text: (person ? person.name : '?') + (slot.member === r.host ? ' (host)' : '') }),
          host && !mine ? el('button', { class: 'btn small kick', title: 'Ask them to leave', onclick: () => { if (confirm('Ask ' + (person ? person.name : 'them') + ' to leave?')) net.kick(slot.member); } }, '\u00d7') : null);
      } else if (host) {
        who = el('select', { 'aria-label': 'Slot ' + (i + 1), onchange: (e) => net.setSlot(i, { kind: e.target.value }) },
          el('option', { value: 'open', text: 'Open', selected: slot.kind === 'open' }),
          el('option', { value: 'bot', text: 'Computer', selected: slot.kind === 'bot' }),
          el('option', { value: 'closed', text: 'Closed', selected: slot.kind === 'closed' }));
      } else {
        who = el('div', { class: 'who' }, el('span', { class: 'name', text: { open: 'Open', bot: 'Computer', closed: 'Closed' }[slot.kind] }));
      }
      const canEdit = mine || (host && slot.kind === 'bot');
      const inPlay = slot.kind === 'member' || slot.kind === 'bot';
      const faction = el('select', { 'aria-label': 'Faction', disabled: !canEdit, onchange: (e) => net.setSlot(i, { faction: e.target.value }) },
        ...(inPlay ? factionChoices : ['random']).map((f) => el('option', { value: f, text: FACTIONS[f], selected: slot.faction === f })));
      const colour = el('select', { 'aria-label': 'Colour', disabled: !canEdit, onchange: (e) => net.setSlot(i, { colour: e.target.value }) },
        ...COLOURS.map((c) => el('option', { value: c, text: c[0].toUpperCase() + c.slice(1), selected: slot.colour === c })));
      let extra;
      if (slot.kind === 'bot') {
        extra = el('select', { 'aria-label': 'Difficulty', disabled: !host, onchange: (e) => net.setSlot(i, { difficulty: e.target.value }) },
          ...Object.entries(DIFFICULTIES).map(([k, v]) => el('option', { value: k, text: v, selected: slot.difficulty === k })));
      } else if (slot.kind === 'open') {
        extra = el('button', { class: 'btn small', onclick: () => net.take(i, this.settings.faction, this.settings.colour) }, 'Take');
      } else if (slot.kind === 'member') {
        extra = el('div', { class: 'who', text: mine ? 'You' : person && person.rtt ? person.rtt + 'ms' : '' });
      } else {
        extra = el('div');
      }
      rows.push(el('div', { class: 'slot' + (slot.kind === 'closed' ? ' closed' : '') + (over ? ' over' : '') + (mine ? ' mine' : '') },
        el('div', { class: 'num' }, el('span', { class: 'swatch', style: 'background:' + (inPlay && slot.colour ? COLOUR_CSS[slot.colour] : '#555') })),
        who, faction, colour, extra));
    }
    this.roomSlots.replaceChildren(...rows);
    const seated = new Set(r.slots.slice(0, r.count).filter((x) => x.kind === 'member').map((x) => x.member));
    const watchers = r.members.filter((x) => !seated.has(x.id));
    this.roomWatchers.replaceChildren(
      el('span', { class: 'nospell', text: watchers.length ? 'Watching: ' + watchers.map((x) => x.name).join(', ') : '' }),
      // (replaceChildren would write a null out as the word)
      ...(mySlot >= 0 ? [el('button', { class: 'btn small', onclick: () => net.spectate() }, 'Watch instead')] : []));
    // the match: the host changes it; everyone sees it
    this.roomMatchForm.replaceChildren(...matchGroups((x) => {
      const select = el('select', { 'aria-label': x.label, disabled: !host || !x.ready || (x.when && !x.when(m)), onchange: (e) => {
        const c = x.choices.find(([v]) => String(v) === e.target.value);
        this.setRoomMatch({ [x.key]: c ? c[0] : m[x.key] });
      } }, ...x.choices.map(([v, t]) => el('option', { value: String(v), text: t, selected: String(m[x.key]) === String(v) })));
      return [el('label', {}, x.label), select];
    }));
    const problem = r.phase === 'playing' ? 'A match is under way.' : this.roomProblem(r, map);
    this.roomNotice.textContent = problem || (host ? '' : 'The host starts the match.');
    this.roomStart.style.display = host ? '' : 'none';
    this.roomStart.disabled = !!problem;
    this.roomMatchReset.style.display = host ? '' : 'none';
    this.roomMatchReset.disabled = r.phase === 'playing';
    this.renderChat();
  }

  roomProblem(r, map) {
    const inUse = r.slots.slice(0, r.count).filter((x) => x.kind === 'member' || x.kind === 'bot');
    if (inUse.length > map.bases) return map.name + ' has room for ' + map.bases + ' players: close a slot, or pick a bigger map.';
    if (inUse.length < 2) return 'A match needs at least two players.';
    const teams = new Set(inUse.map((x) => x.colour));
    if (teams.size < 2) return 'Everyone is on the same team (the same colour): someone needs another colour.';
    return null;
  }

  renderChat() {
    this.chatLog.replaceChildren(...this.chatLines.map((c) => (c.system
      ? el('div', { class: 'line system', text: c.text })
      : el('div', { class: 'line' }, el('b', { text: c.name + ': ' }), c.text))));
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  // The host starts: the players as the game takes them (people as "remote", each with their
  // member id for the room to seat them; computer players; then everyone watching), factions
  // made up where random, bases spread as a skirmish's are.
  startOnline() {
    const net = this.net;
    const r = net.room;
    const m = this.roomMatch();
    const map = this.maps().find((x) => x.id === String(m.map)) || this.maps()[0];
    if (!net.isHost || this.roomProblem(r, map)) return;
    this.sound('INT_construction');
    const members = Object.fromEntries(r.members.map((x) => [x.id, x]));
    const pick = (f) => {
      const faction = m.factions === 'random' ? 'random' : f;
      return faction === 'random' || !faction ? (Math.random() < 0.5 ? 'good' : 'evil') : faction;
    };
    const players = [];
    r.slots.slice(0, r.count).forEach((x, i) => {
      if (x.kind === 'member') players.push({ name: (members[x.member] && members[x.member].name) || 'Player', faction: pick(x.faction), colour: x.colour, control: 'remote', member: x.member, slot: i });
      else if (x.kind === 'bot') players.push({ name: 'Computer ' + (i + 1), faction: pick(x.faction), colour: x.colour, control: 'bot', difficulty: x.difficulty || 'medium', slot: i });
    });
    const bases = (map.info && map.info.bases) || [];
    const chosen = spreadBases(bases, players.map((pl) => pl.colour));
    players.forEach((pl, i) => { pl.base = chosen ? chosen[i] : bases[pl.slot]; });
    const seated = new Set(players.map((pl) => pl.member).filter(Boolean));
    for (const x of r.members) if (!seated.has(x.id)) players.push({ name: x.name, control: 'spectator', member: x.id, faction: 'good', colour: 'black' });
    const settings = {
      map: /^\d+$/.test(String(m.map)) ? Number(m.map) : m.map, mode: m.mode, cash: m.cash, units: m.units, prebuilt: m.prebuilt, shroud: m.shroud,
      superweapons: m.superweapons, palette: m.palette, speed: m.speed, regrowth: m.regrowth, specops: m.specops, opsHQ: m.opsHQ !== false, balance: m.balance || 'vanilla',
      crates: m.crates, christmas: m.christmas, crateRate: m.crateRate, income: m.income, pizzaCost: m.pizzaCost,
      build: m.build || 1, queue: !!m.queue, shields: !!m.shields, captures: m.captures || 1,
      shareMoney: m.shareMoney, sharePower: m.sharePower, shareUnits: m.shareUnits, shareBuildings: m.shareBuildings, players,
      // (the map by its name, for the server's log: the game goes by map)
      mapName: map.name,
    };
    net.start(settings);
  }

  // The network's news, for the menus and the game.
  wireNet() {
    const net = this.net;
    if (!net) return;
    net.on = {
      room: () => { if (this.screens.room.classList.contains('active')) this.renderRoom(); },
      chat: (c) => {
        this.chatLines.push(c);
        if (this.chatLines.length > 60) this.chatLines.shift();
        if (this.screens.room.classList.contains('active')) this.renderChat();
      },
      status: (text) => { if (this.roomNotice && text) this.roomNotice.textContent = text; },
      // A match: this page's player's palette, the match's seed, and the game.
      start: (settings) => {
        settings.palette = paletteFor(settings.palette, this.settings.palette, net.match.seed);
        if (this.settings.faction && settings.spectator) settings.spectator = undefined;
        this.player.seedRandom(net.match.seed);
        if (this.hooks.setSpeed) this.hooks.setSpeed(settings.speed);
        const p = this.panel;
        if (p && p.game) p.skirmishOver();
        this.close();
        if (p && p.startSkirmish) p.startSkirmish(settings);
      },
      desync: (n) => this.toast('This game has gone out of step with the others (turn ' + n + '), which should not happen. Please report it (the notice in the corner has a report to copy).'),
      // Quit from the pause menu: out of the match and the room.
      quit: () => {
        net.leave();
        const p = this.panel;
        if (p && p.game) p.skirmishOver();
        this.show('online');
      },
      closed: (why) => {
        const p = this.panel;
        if (p && p.game && net.active) p.skirmishOver();
        net.endMatch();
        this.open('online');
        this.onlineNotice.textContent = why === 'kicked' ? 'The host asked you to leave the game.' : 'The connection to the game was lost.';
      },
    };
  }

  toast(text) {
    const t = el('div', { class: 'toast', text });
    document.body.append(t);
    setTimeout(() => t.remove(), 12000);
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
    this.settingsBody.replaceChildren(...this.settingsRows(false));
  }

  settingsRows(ingame) {
    const st = this.settings;
    const save = () => { saveSettings(st); this.applyVolumes(); this.applyPrefs(); };
    const name = el('input', { type: 'text', maxlength: 16, value: st.name, 'aria-label': 'Name', oninput: (e) => { st.name = e.target.value.trim() || 'Player'; save(); } });
    const faction = el('select', { 'aria-label': 'Faction', onchange: (e) => { st.faction = e.target.value; this.slots[0].faction = st.faction; save(); } },
      el('option', { value: 'good', text: 'Astro', selected: st.faction === 'good' }),
      el('option', { value: 'evil', text: 'Alien', selected: st.faction === 'evil' }),
      el('option', { value: 'random', text: 'Random', selected: st.faction === 'random' }));
    const colours = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' },
      ...COLOURS.map((c) => el('span', { class: 'swatch' + (st.colour === c ? ' on' : ''), role: 'radio', 'aria-checked': st.colour === c ? 'true' : 'false', tabindex: 0, title: c, style: 'background:' + COLOUR_CSS[c],
        onclick: () => { st.colour = c; this.slots[0].colour = c; save(); this.sound('INT_cursor_select'); if (!ingame) this.renderSettings(); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); } } })));
    const palette = el('select', { 'aria-label': 'Map palette', onchange: (e) => { st.palette = e.target.value; save(); } },
      el('option', { value: 'all', text: 'As the host chooses', selected: st.palette === 'all' }),
      ...PALETTES.map(([key, name]) => el('option', { value: key, text: 'Always ' + name, selected: st.palette === key })),
      el('option', { value: 'random', text: 'Random each match', selected: st.palette === 'random' }));
    const SIZE_NAMES = { small: 'Small (see more of the map)', medium: 'Medium', large: 'Large', fill: 'Fill the window' };
    const size = el('select', { 'aria-label': 'In-Game Interface Size', onchange: (e) => { st.size = e.target.value; save(); if (this.hooks.setSize) this.hooks.setSize(st.size); } },
      ...Object.keys(UI_SCALES).map((k) => el('option', { value: k, text: SIZE_NAMES[k], selected: st.size === k })));
    // What the size does -- the game in a match, not these menus -- and which sizes look the same
    // in this window: none enlarges the game past what the window holds (src/main.js setSize).
    const sizeNote = el('div', { class: 'wide note' });
    this.explainSize = () => {
      const r = this.player.renderer && this.player.renderer.canvas.getBoundingClientRect();
      const fit = r && r.width && r.height ? Math.min(r.width / 600, r.height / 400) : Infinity;
      const alike = Object.keys(UI_SCALES).filter((k) => UI_SCALES[k] >= fit).map((k) => SIZE_NAMES[k].replace(/ \(.*/, ''));
      const list = alike.length > 1 ? alike.slice(0, -1).join(', ') + ' and ' + alike[alike.length - 1] : '';
      sizeNote.textContent = 'How big a match is drawn: the sidebar, the map and its units (not these menus). Smaller shows more of the map at once.' +
        (list ? ' In a window this size ' + list + ' look the same: a bigger window tells them apart.' : '');
    };
    this.explainSize();
    if (!this.watchingSize) {
      this.watchingSize = true;
      addEventListener('resize', () => { if (this.screens.settings.classList.contains('active')) this.explainSize(); });
    }
    const healthBars = el('select', { 'aria-label': 'Always Show Health Bars', onchange: (e) => { st.healthBars = e.target.value; save(); } },
      ...[['off', 'Off (Vanilla)'], ['units', 'Units'], ['buildings', 'Buildings'], ['all', 'All']].map(([v, t]) => el('option', { value: v, text: t, selected: st.healthBars === v })));
    const onOff = (key, label) => el('select', { 'aria-label': label, onchange: (e) => { st[key] = e.target.value === 'on'; save(); } },
      el('option', { value: 'on', text: 'On', selected: st[key] }),
      el('option', { value: 'off', text: 'Off', selected: !st[key] }));
    const slider = (key) => el('input', { type: 'range', min: 0, max: 100, value: Math.round(st[key] * 100), 'aria-label': key,
      oninput: (e) => { st[key] = Number(e.target.value) / 100; save(); },
      onchange: () => { if (key !== 'music') this.sound(key === 'ui' ? 'INT_cursor_select' : 'INT_collect'); } });
    // (its own words as they are, in either spelling: .nospell)
    const english = el('select', { class: 'nospell', 'aria-label': 'English Spelling', onchange: (e) => { st.english = e.target.value; save(); this.respell(); } },
      el('option', { value: 'european', text: 'European (Colour, Centre, Defence)', selected: st.english !== 'american' }),
      el('option', { value: 'american', text: 'American (Color, Center, Defense)', selected: st.english === 'american' }));
    const section = (title) => el('div', { class: 'wide section', text: title });
    const row = (label, control) => [el('label', { text: label }), control];
    // (in a match: the Screensaver's, if it is one)
    const screensaver = !ingame || !!(this.screensaver && this.panel && this.panel.skirmish && this.panel.skirmish.screensaver);
    return [
      ...(ingame ? [] : [...row('Name', name), ...row('Faction', faction), ...row('Colour', colours)]),
      section('Display'),
      ...(ingame ? [] : row('Map palette', palette)),
      el('label', { text: 'In-Game Interface Size' }), size, ...(ingame ? [] : [sizeNote]),
      el('label', { text: 'English Spelling' }), english,
      el('label', { text: 'Team-Coloured Sidebar Icons' }), onOff('teamIcons', 'Team-Coloured Sidebar Icons'),
      el('label', { text: 'Show Unit/Building Count' }), onOff('ownedCounts', 'Show Unit/Building Count'),
      el('label', { text: 'Always Show Health Bars' }), healthBars,
      section('Controls'),
      el('label', { text: 'Scroll at the edges' }), onOff('edgeScroll', 'Scroll at the edges'),
      el('label', { text: 'Ignore Miners When Dragging' }), onOff('ignoreMinersDrag', 'Ignore Miners When Dragging'),
      el('label', { text: 'Ignore Engineers When Dragging' }), onOff('ignoreEngineersDrag', 'Ignore Engineers When Dragging'),
      el('label', { text: 'Allow Multiple Miners to Return On Click' }), onOff('multiMinerReturn', 'Allow Multiple Miners to Return On Click'),
      el('label', { text: 'Allow Multiple Fighters to Return On Click' }), onOff('multiFighterReturn', 'Allow Multiple Fighters to Return On Click'),
      section('Gameplay'),
      el('label', { text: 'New miners to crystals' }), onOff('autoMine', 'New miners to crystals'),
      ...(ingame ? [] : row('Special Ops in the Story', onOff('storySpecOps', 'Special Ops in the Story'))),
      ...(screensaver ? [section('Screensaver'),
        ...row('Screensaver Auto Director', onOff('screensaverDirector', 'Screensaver Auto Director')),
        ...row('Screensaver Shows HUD', onOff('screensaverHud', 'Screensaver Shows HUD'))] : []),
      section('Sound'),
      el('label', { text: 'Music' }), slider('music'),
      el('label', { text: 'Sound' }), slider('sound'),
      el('label', { text: 'Interface sounds' }), slider('ui'),
      ...(ingame ? [] : [el('div', { class: 'wide actions' }, el('button', { class: 'btn small', onclick: () => this.resetSettings() }, 'Reset all to default')),
        this.appNote()]),
    ];
  }

  // The settings as they are at first -- all but the player's name (who they are, not a
  // preference) and the skirmish last set up (not on this menu).
  resetSettings() {
    const st = this.settings;
    for (const key of Object.keys(DEFAULTS)) if (key !== 'name' && key !== 'lobby') st[key] = DEFAULTS[key];
    this.slots[0].faction = st.faction;
    this.slots[0].colour = st.colour;
    saveSettings(st);
    this.applyVolumes();
    this.applyPrefs();
    if (this.hooks.setSize) this.hooks.setSize(st.size);
    this.respell();
    this.sound('INT_cursor_select');
    this.renderSettings();
  }

  // The menus' own text in the player's English (spelling.js; the game's goes by the same setting,
  // through its dialogue): every piece of text they show, as it is made or changed, and all of it
  // when the setting changes -- kept as it was written, to go back to.  Not the chat, nor names
  // and what players typed (.nospell, and inputs, which hold no text of this kind).
  watchSpelling() {
    this.spelledFrom = new WeakMap();
    const fix = (node) => {
      if (!node.parentElement || node.parentElement.closest('.chatlog, .nospell, .name')) return;
      const now = node.data;
      let written = this.spelledFrom.get(node);
      if (written === undefined || (now !== written && now !== american(written))) {
        written = now;
        this.spelledFrom.set(node, written);
      }
      const want = this.settings.english === 'american' ? american(written) : written;
      if (now !== want) node.data = want;
    };
    const walk = (root) => {
      if (root.nodeType === 3) return fix(root);
      const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = it.nextNode(); n; n = it.nextNode()) fix(n);
    };
    this.respell = () => { walk(this.root); if (this.ingame) walk(this.ingame); };
    new MutationObserver((changes) => {
      for (const c of changes) {
        if (c.type === 'characterData') fix(c.target);
        else for (const n of c.addedNodes) walk(n);
      }
    }).observe(this.root, { childList: true, subtree: true, characterData: true });
    this.respell();
  }

  // The app (client/): its version, or, in a browser, where to get it.
  appNote() {
    const app = window.crystalienApp;
    if (app) return el('label', { class: 'wide', text: 'The app, version ' + app.version + '. It keeps itself up to date.' });
    return el('div', { class: 'wide note' }, 'Play without a browser: ',
      el('a', { href: 'https://github.com/AgitationSkeleton/crystalienconflict-html5-online/releases/latest', target: '_blank', rel: 'noopener', text: 'the app, for Windows, Mac and Linux' }),
      '. It keeps itself up to date.');
  }

  // What the game reads of the settings while it plays.
  applyPrefs() {
    this.player.online.prefs = { edgeScroll: this.settings.edgeScroll !== false, autoMine: this.settings.autoMine !== false, ownedCounts: !!this.settings.ownedCounts, teamIcons: this.settings.teamIcons !== false, storySpecOps: !!this.settings.storySpecOps, healthBars: this.settings.healthBars || 'off',
      ignoreMinersDrag: !!this.settings.ignoreMinersDrag, ignoreEngineersDrag: !!this.settings.ignoreEngineersDrag,
      multiMinerReturn: !!this.settings.multiMinerReturn, multiFighterReturn: !!this.settings.multiFighterReturn,
      english: this.settings.english === 'american' ? 'american' : 'european',
      screensaverDirector: this.settings.screensaverDirector !== false, screensaverHud: !!this.settings.screensaverHud };
  }

  applyVolumes() {
    const snd = this.player.sound;
    if (snd && snd.setVolumes) snd.setVolumes({ music: this.settings.music, sound: this.settings.sound, ui: this.settings.ui });
  }
}
