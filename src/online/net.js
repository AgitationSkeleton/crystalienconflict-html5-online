// Online play: the master server's list, and a match room over a WebSocket (the server:
// server/src/room.js, which explains the protocol).
//
// A match is lockstep: every browser runs the same game, from the same seed, and only what the
// players order travels.  A turn is `turnTicks` of the game's frames.  What this player orders
// (Level.issue hands it here) goes to the room for a turn `delay` turns ahead; the room sends
// each turn's bundle (everyone's orders for it) to everyone, and the game runs a turn only when
// its bundle is here (ready()), the bundle's orders going into the level's commandQueue on the
// turn's first frame (beforeTick()).  So every browser runs every order on the same frame.  A
// page behind the room (a slow moment, a hidden tab, someone joining a match under way, who
// plays it from the start) runs extra frames until it has caught up (behind()).  Now and then
// the page hashes its game and the room compares: if two ever differ, everyone is told.

const TOKEN_KEY = 'caconline.token';
const HASH_EVERY = 32;

// The server; ?server=URL points the page at another (a local one, for testing).
export function serverRoot(params) {
  return (params.get('server') || 'https://cacserver.viosarcade.xyz').replace(/\/+$/, '');
}

// This browser's secret for rooms: the room knows a member who lost their connection by it.
function token() {
  try {
    let t = sessionStorage.getItem(TOKEN_KEY);
    if (!t) {
      t = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch (e) {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

// A hash of the game: every unit and building, every player's money (not those watching: a page
// joining a match under way has a seat of its own for that), the simulation's random draws.  Two browsers with the same game have the same hash.
export function stateHash(level, player) {
  let h = 2166136261 >>> 0;
  const mix = (v) => {
    const t = typeof v === 'number' ? String(Number.isFinite(v) ? Math.round(v * 1000) : v) : String(v);
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 124; h = Math.imul(h, 16777619) >>> 0;
  };
  mix(level.count); mix(player.simCalls);
  for (const p of level.players || []) { if (!p.spectator) { mix(p.index); mix(p.cash); mix(!!p.defeated); } }
  for (const u of level.units || []) { if (u && u.active) { mix(u.id); mix(u.type); mix(u.posX); mix(u.posY); mix(u.health); mix(u.owner ? u.owner.index : -1); } }
  for (const b of level.buildings || []) { if (b && b.active) { mix(b.id); mix(b.type); mix(b.health); mix(b.owner ? b.owner.index : -1); } }
  return h.toString(16);
}

export class Net {
  // on: { room(room), chat(msg), start(settings, match), closed(reason), desync(n), status(text) }
  constructor(player, root, on) {
    this.player = player;
    this.root = root;
    this.wsRoot = root.replace(/^http/, 'ws');
    this.on = on || {};
    this.ws = null;
    this.code = null;
    this.room = null;
    this.you = null;
    this.match = null;
    this.active = false;             // a match under way (the game asks: Online.net.active)
    this.token = token();
  }

  // ---- the master server --------------------------------------------------------------------------
  async list() {
    const r = await fetch(this.root + '/lobbies', { cache: 'no-store' });
    if (!r.ok) throw new Error('the server answered ' + r.status);
    return (await r.json()).rooms || [];
  }

  // How long a room takes to answer (its Durable Object lives near whoever made it).
  async ping(code) {
    const t = performance.now();
    const r = await fetch(this.root + '/rooms/' + code, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    await r.json();
    return Math.round(performance.now() - t);
  }

  async create(opts) {
    const r = await fetch(this.root + '/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts || {}) });
    const j = await r.json();
    if (!r.ok || !j.code) throw new Error(j.error || 'could not make a room');
    return j.code;
  }

  // ---- a room ------------------------------------------------------------------------------------
  join(code, who) {
    this.leave();
    this.code = String(code).toUpperCase();
    this.who = who;
    this.closing = false;
    return new Promise((resolve, reject) => {
      this.pendingJoin = { resolve, reject };
      this.connect();
    });
  }

  connect() {
    const ws = new WebSocket(this.wsRoot + '/rooms/' + this.code + '/ws');
    this.ws = ws;
    ws.addEventListener('open', () => {
      const hello = Object.assign({ type: 'hello', token: this.token }, this.who);
      if (this.match) hello.have = this.match.next;      // back after losing the connection
      ws.send(JSON.stringify(hello));
      this.retries = 0;
    });
    ws.addEventListener('message', (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      this.message(m);
    });
    ws.addEventListener('close', (ev) => this.closed(ws, ev));
    clearInterval(this.pinger);
    this.pinger = setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
  }

  closed(ws, ev) {
    if (ws !== this.ws) return;
    clearInterval(this.pinger);
    this.ws = null;
    if (this.pendingJoin) {
      const reason = { 4001: 'password', 4002: 'full', 4003: 'kicked' }[ev.code] || this.lastError || 'could not connect';
      this.pendingJoin.reject(new Error(reason));
      this.pendingJoin = null;
      return;
    }
    // Lost in a match, or in the room: try again a few times (the room keeps a player's seat
    // for a while); then it is over.
    if (!this.closing && this.code && (this.retries || 0) < 6) {
      this.retries = (this.retries || 0) + 1;
      if (this.on.status) this.on.status('Connection lost: trying again...');
      setTimeout(() => { if (!this.closing && !this.ws) this.connect(); }, 500 * this.retries);
      return;
    }
    const was = this.code;
    this.code = null;
    this.room = null;
    if (was && !this.closing && this.on.closed) this.on.closed(this.lastError || 'lost');
  }

  send(m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  leave() {
    this.closing = true;
    this.endMatch();
    clearInterval(this.pinger);
    if (this.ws) {
      try {
        this.ws.close(1000, 'leaving');
      } catch (e) {
        // (closed)
      }
    }
    this.ws = null;
    this.code = null;
    this.room = null;
    this.you = null;
  }

  message(m) {
    switch (m.type) {
      case 'welcome':
        this.you = m.you;
        this.room = m.room;
        if (this.pendingJoin) {
          this.pendingJoin.resolve(m.room);
          this.pendingJoin = null;
        }
        if (this.on.room) this.on.room(this.room);
        if (this.on.status) this.on.status('');
        break;
      case 'room':
        this.room = m.room;
        if (this.on.room) this.on.room(this.room);
        break;
      case 'chat':
        if (this.on.chat) this.on.chat(m);
        break;
      case 'pong':
        this.rtt = Math.round(performance.now() - m.t);
        this.send({ type: 'rtt', rtt: this.rtt });
        break;
      case 'start':
        this.beginMatch(m);
        break;
      case 't':
        this.bundle(m);
        break;
      case 'log':
        for (const b of m.bundles) this.bundle(b);
        break;
      case 'desync':
        if (this.on.desync) this.on.desync(m.n);
        break;
      case 'kicked':
        this.lastError = 'kicked';
        this.closing = true;
        this.endMatch();
        if (this.on.closed) this.on.closed('kicked');
        break;
      case 'bye':
        this.lastError = m.reason || 'closed';
        break;
      case 'error':
        this.lastError = m.reason;
        if (!this.pendingJoin && this.on.status) this.on.status('The room says: ' + m.reason);
        break;
      default:
        break;
    }
  }

  // The room's commands, for the lobby.
  take(slot, faction, colour) { this.send({ type: 'take', slot, faction, colour }); }
  spectate() { this.send({ type: 'spectate' }); }
  setSlot(slot, changes) { this.send(Object.assign({ type: 'slot', slot }, changes)); }
  setCount(count) { this.send({ type: 'slots', count }); }
  setMatch(match) { this.send({ type: 'match', match }); }
  setAccess(access, password) { this.send({ type: 'access', access, password }); }
  kick(member) { this.send({ type: 'kick', member }); }
  chat(text) { this.send({ type: 'chat', text }); }
  start(settings) { this.send({ type: 'start', settings }); }
  get isHost() { return !!(this.room && this.you && this.room.host === this.you); }

  // ---- a match -------------------------------------------------------------------------------
  // The room starts a match: this page's seat is made its own ("local"); a page with no seat
  // (joining while it is under way) watches.  The page starts the game (on.start).
  beginMatch(m) {
    const seat = m.seats ? m.seats[this.you] : undefined;
    const settings = JSON.parse(JSON.stringify(m.settings));
    settings.players = settings.players.map((p, i) => {
      const q = Object.assign({}, p);
      if (i === seat) {
        if (q.control === 'spectator') q.local = true;
        else q.control = 'local';
      }
      delete q.member;
      return q;
    });
    const playing = seat !== undefined && settings.players[seat].control === 'local';
    if (seat === undefined) settings.players.push({ name: (this.who && this.who.name) || 'Watching', control: 'spectator', local: true, faction: 'good', colour: 'black' });
    this.match = { seed: m.seed, delay: m.delay, K: m.turnTicks || 2, seat, playing, settings, bundles: new Map(), next: 0, latest: -1, sentUpTo: m.delay - 1, pending: [], quit: false, hashes: new Map() };
    this.active = true;
    this.player.online.net = this;
    if (this.on.start) this.on.start(settings, this.match);
  }

  endMatch() {
    if (this.player.online.net === this) this.player.online.net = null;
    this.active = false;
    this.match = null;
  }

  // What this player orders (Level.issue): into the next input.
  issue(c) {
    const mt = this.match;
    if (mt && mt.playing && !mt.quit) mt.pending.push(c);
  }

  bundle(b) {
    const mt = this.match;
    if (!mt || b.n < mt.next) return;
    mt.bundles.set(b.n, b);
    if (b.n > mt.latest) mt.latest = b.n;
  }

  level() {
    const g = this.player.levels[1];
    const game = g && g.panel && g.panel.game;
    return game && game.level;
  }

  // May the game run its next frame?  Not at a turn's first frame without the turn's bundle.
  ready() {
    const mt = this.match;
    const lv = this.level();
    if (!mt || !lv || !lv.active) return true;
    if (lv.count % mt.K !== 0) return true;
    return mt.bundles.has(lv.count / mt.K);
  }

  // Before a frame: at a turn's first, its orders go to the level, this player's input for a
  // turn `delay` ahead goes to the room, and now and then the game's hash.
  beforeTick() {
    const mt = this.match;
    const lv = this.level();
    if (!mt || !lv || !lv.active || lv.count % mt.K !== 0) return;
    const t = lv.count / mt.K;
    const b = mt.bundles.get(t);
    if (!b) return;
    mt.bundles.delete(t);
    mt.next = t + 1;
    if (t % HASH_EVERY === 0 && t > 0) {
      const h = stateHash(lv, this.player);
      mt.hashes.set(t, h);
      if (mt.hashes.size > 64) mt.hashes.delete(mt.hashes.keys().next().value);
      if (mt.playing) this.send({ type: 'hash', n: t, h });
    }
    for (const p of b.left || []) lv.commandQueue.push({ t: 'surrender', p });
    for (const [p, c] of b.c) lv.commandQueue.push(Object.assign({}, c, { p }));
    if (mt.playing && !mt.quit) {
      while (mt.sentUpTo < t + mt.delay) {
        mt.sentUpTo++;
        this.send({ type: 'in', n: mt.sentUpTo, c: mt.sentUpTo === t + mt.delay ? mt.pending.splice(0) : [] });
      }
    }
  }

  // Turns the room has sent that this page has not run.
  behind() {
    const mt = this.match;
    return mt ? mt.latest - mt.next + 1 : 0;
  }

  slack() {
    return this.match ? this.match.delay + 2 : 0;
  }

  // Quit from the pause menu: surrender (the game goes on for the rest), and leave.
  quit() {
    const mt = this.match;
    if (mt) mt.quit = true;
    this.send({ type: 'surrender' });
    if (this.on.quit) this.on.quit();
  }

  // The match is over on this page (the game has gone back to the menus).
  ended() {
    if (this.match && this.match.playing && !this.match.quit) this.send({ type: 'ended' });
    this.endMatch();
  }
}
