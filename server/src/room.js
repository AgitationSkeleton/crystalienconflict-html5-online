// A match room: the lobby where players gather and the match they play, one Durable Object for
// each (named by the room's code).  Everyone in it is connected by a WebSocket.
//
// The lobby: members (people connected), six slots (a member's, a computer player's, open or
// closed; the match uses the first `match.slots`), the match settings, and the host, who
// changes the settings and starts the match.  A member without a slot watches.
//
// The match: every browser runs the same game (deterministic lockstep; src/online/net.js on
// the page).  A turn is two of the game's frames.  Each player sends what they ordered for a
// turn `delay` turns ahead; the room gathers every player's input for a turn and sends the
// bundle to everyone, who all run it on that turn.  A player who falls behind (a hidden tab, a
// slow line) is waited for only a moment: then the turn goes without them, they are "lagging"
// and not waited for until they catch up, and what they send late goes in the next turn.  A
// player who disconnects has 20 seconds to come back; after that, or if they surrender, the
// bundle says they left and every browser blows up what was theirs.  Every browser hashes its
// game now and then, and the room says if they ever differ.  The room keeps every bundle, so
// that someone joining a match under way can watch it: their browser plays it from the start.
//
// Messages are JSON.  From the page:
//   hello {name, token, password}      first, always; token (the page's secret) lets a member
//                                      who lost their connection come back as themselves
//   chat {text}  ping {t}
//   take {slot}  spectate {}           take an open slot / give up one's slot to watch
//   slot {slot, faction, colour, difficulty, kind}   one's own slot; the host: any bot's, and a
//                                      slot's kind (open, closed, bot)
//   slots {count}  match {...}  access {access, password}  kick {member}  start {settings}
//                                      (the host)
//   in {n, c}  hash {n, h}  have {n}  surrender {}  ended {}     (in a match)
// From the room:
//   welcome {you, room}  room {room}  chat {from, name, text}  pong {t}  error {reason}
//   start {settings, seed, seats, delay, turnTicks, from}   a match (seats: member -> player)
//   t {n, c: [[player, command], ...], left: [player, ...]}  a turn's bundle
//   log {bundles}                      bundles so far, for one who joined a match under way
//   desync {n}  kicked {}  bye {reason}

import { DurableObject } from 'cloudflare:workers';
import { json, allowedOrigin, sha256Hex, cleanName } from './http.js';

const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const TURN_TICKS = 2;
const FRAME_MS = 1000 / 23;
const LATE_MS = 250;            // how long a turn waits for a player behind the rest
const GRACE_MS = 20000;         // how long a disconnected player's seat is kept
const EMPTY_MS = 60000;         // how long a room with nobody in it lasts
const HEARTBEAT_MS = 30000;     // how often a listed room tells the master server it is there
const COLOURS = ['orange', 'green', 'red', 'blue', 'purple', 'black', 'tan', 'cyan'];

export function newCode() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

function randomId(n = 8) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

// ---- the Worker's side: making a room, finding one, connecting to one ----------------------------
export async function handleRooms(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean);            // rooms, CODE, ws
  if (parts.length === 1 && request.method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      // (no settings: a public room)
    }
    for (let i = 0; i < 6; i++) {
      const code = newCode();
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      const r = await stub.init(code, { access: body.access, password: body.password, name: body.name });
      if (r.ok) return json(env, request, { code });
    }
    return json(env, request, { error: 'busy' }, 503);
  }
  const code = String(parts[1] || '').toUpperCase();
  if (!CODE_RE.test(code)) return json(env, request, { error: 'no such room' }, 404);
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  if (parts[2] === 'ws') {
    if (request.headers.get('Upgrade') !== 'websocket') return json(env, request, { error: 'expected a WebSocket' }, 426);
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigin(env, origin)) return json(env, request, { error: 'origin' }, 403);
    return stub.fetch(request);
  }
  if (parts.length === 2 && request.method === 'GET') return json(env, request, await stub.info());
  return json(env, request, { error: 'not found' }, 404);
}

// ---- the room ------------------------------------------------------------------------------------
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.members = new Map();       // id -> { id, token, name, ws, connected, rtt, joined, left }
    this.game = null;               // the match under way
    this.timers = {};
  }

  // ---- made by the Worker ------------------------------------------------------------------------
  async init(code, opts) {
    if (this.room) return { ok: false };
    const access = ['public', 'password', 'invite'].includes(opts.access) ? opts.access : 'public';
    this.room = {
      code,
      name: cleanName(opts.name, 32) || 'A game',
      access,
      passHash: access === 'password' && opts.password ? await sha256Hex(code + '|' + String(opts.password)) : null,
      created: Date.now(),
      host: null,
      phase: 'lobby',
      match: null,                  // the host's match settings (map, mode, ...), as the page keeps them
      slots: [0, 1, 2, 3, 4, 5].map(() => ({ kind: 'open' })),
      count: 2,
      banned: [],
      version: 0,
    };
    this.expireSoon();
    return { ok: true };
  }

  async info() {
    if (!this.room) return { code: null, exists: false };
    return { code: this.room.code, exists: true, phase: this.room.phase, access: this.room.access, name: this.room.name,
      players: this.room.slots.slice(0, this.room.count).filter((s) => s.kind === 'member' || s.kind === 'bot').length, slots: this.room.count };
  }

  // ---- connections -----------------------------------------------------------------------------
  async fetch(request) {
    if (!this.room) return new Response('no such room', { status: 404 });
    const pair = new WebSocketPair();
    const [client, ws] = Object.values(pair);
    ws.accept();
    const conn = { ws, member: null, chat: [] };
    ws.addEventListener('message', (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data));
      } catch (e) {
        return;
      }
      try {
        this.onMessage(conn, m);
      } catch (e) {
        this.send(ws, { type: 'error', reason: 'server', message: String(e && e.message || e) });
      }
    });
    const closed = () => this.onClose(conn);
    ws.addEventListener('close', closed);
    ws.addEventListener('error', closed);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, m) {
    try {
      ws.send(JSON.stringify(m));
    } catch (e) {
      // (gone: its close will come)
    }
  }

  broadcast(m) {
    const s = JSON.stringify(m);
    for (const mem of this.members.values()) {
      if (mem.connected && mem.ws) {
        try {
          mem.ws.send(s);
        } catch (e) {
          // (as above)
        }
      }
    }
  }

  // The room as the pages see it (no tokens, no password).
  view() {
    const r = this.room;
    return {
      code: r.code, name: r.name, access: r.access, host: r.host, phase: r.phase, match: r.match, count: r.count,
      slots: r.slots.map((s) => Object.assign({}, s)),
      members: [...this.members.values()].filter((m) => !m.left).map((m) => ({ id: m.id, name: m.name, connected: m.connected, rtt: m.rtt })),
      version: r.version,
    };
  }

  changed() {
    this.room.version++;
    this.broadcast({ type: 'room', room: this.view() });
    this.tellLobby();
  }

  onMessage(conn, m) {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'ping') return this.send(conn.ws, { type: 'pong', t: m.t });
    if (!conn.member) {
      if (m.type === 'hello') return this.hello(conn, m);
      return this.send(conn.ws, { type: 'error', reason: 'hello first' });
    }
    const mem = conn.member;
    const r = this.room;
    const host = mem.id === r.host;
    switch (m.type) {
      case 'rtt':
        mem.rtt = Math.max(0, Math.min(5000, Math.round(Number(m.rtt) || 0)));
        break;
      case 'chat': {
        const now = Date.now();
        conn.chat = conn.chat.filter((t) => now - t < 5000);
        if (conn.chat.length >= 5) return;
        conn.chat.push(now);
        const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
        if (text) this.broadcast({ type: 'chat', from: mem.id, name: mem.name, text });
        break;
      }
      case 'take': {
        if (r.phase !== 'lobby') return;
        const i = Number(m.slot);
        if (!(i >= 0 && i < r.count) || r.slots[i].kind !== 'open') return;
        this.unseat(mem.id);
        r.slots[i] = { kind: 'member', member: mem.id, faction: m.faction || 'random', colour: this.freeColour(m.colour) };
        this.changed();
        break;
      }
      case 'spectate':
        if (r.phase !== 'lobby') return;
        this.unseat(mem.id);
        this.changed();
        break;
      case 'slot': {
        if (r.phase !== 'lobby') return;
        const i = Number(m.slot);
        const s = r.slots[i];
        if (!s) return;
        const mine = s.kind === 'member' && s.member === mem.id;
        if (!mine && !host) return;
        if (host && m.kind && s.kind !== 'member' && ['open', 'closed', 'bot'].includes(m.kind)) {
          r.slots[i] = m.kind === 'bot' ? { kind: 'bot', faction: s.faction || 'random', colour: s.colour || this.freeColour(), difficulty: s.difficulty || 'medium' } : { kind: m.kind };
        }
        const t = r.slots[i];
        if (mine || (host && t.kind === 'bot')) {
          if (typeof m.faction === 'string') t.faction = m.faction.slice(0, 12);
          if (COLOURS.includes(m.colour)) t.colour = m.colour;
          if (t.kind === 'bot' && ['easy', 'medium', 'hard'].includes(m.difficulty)) t.difficulty = m.difficulty;
        }
        this.changed();
        break;
      }
      case 'slots': {
        if (!host || r.phase !== 'lobby') return;
        this.setCount(Math.max(2, Math.min(6, Number(m.count) | 0)));
        this.changed();
        break;
      }
      case 'match':
        if (!host || r.phase !== 'lobby' || !m.match || typeof m.match !== 'object') return;
        if (JSON.stringify(m.match).length > 4000) return;
        r.match = m.match;
        this.changed();
        break;
      case 'access':
        if (!host) return;
        if (['public', 'password', 'invite'].includes(m.access)) r.access = m.access;
        if (r.access === 'password' && m.password) {
          sha256Hex(r.code + '|' + String(m.password)).then((h) => { r.passHash = h; this.changed(); });
          return;
        }
        if (r.access !== 'password') r.passHash = null;
        this.changed();
        break;
      case 'kick': {
        if (!host) return;
        const target = this.members.get(String(m.member));
        if (!target || target.id === mem.id) return;
        r.banned.push(target.token);
        this.send(target.ws, { type: 'kicked' });
        this.drop(target, 'kicked');
        break;
      }
      case 'start':
        if (host) this.start(m.settings);
        break;
      case 'in':
        this.input(mem, m);
        break;
      case 'hash':
        this.hash(mem, m);
        break;
      case 'have':
        this.resend(mem, Number(m.n) | 0);
        break;
      case 'surrender':
        this.surrender(mem);
        break;
      case 'ended':
        this.ended(mem);
        break;
      default:
        break;
    }
  }

  async hello(conn, m) {
    const r = this.room;
    const token = String(m.token || '').slice(0, 64);
    if (!token || token.length < 12) return this.send(conn.ws, { type: 'error', reason: 'token' });
    if (r.banned.includes(token)) {
      this.send(conn.ws, { type: 'kicked' });
      return conn.ws.close(4003, 'kicked');
    }
    let mem = [...this.members.values()].find((x) => x.token === token && !x.left);
    if (!mem) {
      if (r.passHash && (await sha256Hex(r.code + '|' + String(m.password || ''))) !== r.passHash) {
        this.send(conn.ws, { type: 'error', reason: 'password' });
        return conn.ws.close(4001, 'password');
      }
      if (this.members.size >= 16) {
        this.send(conn.ws, { type: 'error', reason: 'full' });
        return conn.ws.close(4002, 'full');
      }
      mem = { id: randomId(), token, name: cleanName(m.name, 16) || 'Player', ws: null, connected: false, rtt: 0, joined: Date.now(), left: false };
      this.members.set(mem.id, mem);
      if (r.phase === 'lobby') {
        const i = r.slots.slice(0, r.count).findIndex((s) => s.kind === 'open');
        if (i >= 0) r.slots[i] = { kind: 'member', member: mem.id, faction: m.faction || 'random', colour: this.freeColour(m.colour) };
      }
    } else if (mem.ws && mem.ws !== conn.ws) {
      // (the same member from a new connection: the old one is let go)
      try {
        mem.ws.close(4000, 'replaced');
      } catch (e) {
        // (already gone)
      }
    }
    mem.ws = conn.ws;
    mem.connected = true;
    conn.member = mem;
    if (this.timers.grace && this.timers.grace[mem.id]) {
      clearTimeout(this.timers.grace[mem.id]);
      delete this.timers.grace[mem.id];
    }
    if (!r.host || !this.members.get(r.host) || !this.members.get(r.host).connected) r.host = mem.id;
    clearTimeout(this.timers.expire);
    this.startHeartbeat();
    this.send(conn.ws, { type: 'welcome', you: mem.id, room: this.view() });
    // A match under way: the newcomer watches it (or, back after losing their connection, plays
    // on), from wherever their page has got to (have) or the start.
    if (this.game) {
      const g = this.game;
      if (!(Number(m.have) > 0)) this.send(conn.ws, { type: 'start', settings: g.settings, seed: g.seed, seats: g.seats, delay: g.delay, turnTicks: TURN_TICKS, you: mem.id });
      this.resend(mem, Math.max(0, Number(m.have) | 0));
    }
    this.changed();
  }

  onClose(conn) {
    const mem = conn.member;
    if (!mem || mem.ws !== conn.ws) return;
    mem.connected = false;
    mem.ws = null;
    const seat = this.game ? this.game.seats[mem.id] : undefined;
    if (seat !== undefined && !this.game.players[seat].left) {
      // A player in the match: their seat is kept a while, in case they come back.
      this.timers.grace = this.timers.grace || {};
      this.timers.grace[mem.id] = setTimeout(() => {
        delete this.timers.grace[mem.id];
        if (!mem.connected) this.drop(mem, 'gone');
      }, GRACE_MS);
      this.tryEmit();
      this.changed();
      return;
    }
    this.drop(mem, 'gone');
  }

  // A member leaves the room for good.
  drop(mem, why) {
    const r = this.room;
    mem.left = true;
    mem.connected = false;
    if (mem.ws) {
      try {
        mem.ws.close(4000, why);
      } catch (e) {
        // (gone)
      }
    }
    mem.ws = null;
    if (this.game && this.game.seats[mem.id] !== undefined) this.leaveMatch(this.game.seats[mem.id]);
    if (r.phase === 'lobby') this.unseat(mem.id);
    this.members.delete(mem.id);
    if (r.host === mem.id) {
      const next = [...this.members.values()].filter((x) => x.connected).sort((a, b) => a.joined - b.joined)[0];
      r.host = next ? next.id : null;
    }
    if (![...this.members.values()].some((x) => x.connected)) this.expireSoon();
    this.changed();
  }

  unseat(id) {
    const r = this.room;
    r.slots.forEach((s, i) => {
      if (s.kind === 'member' && s.member === id) r.slots[i] = { kind: 'open' };
    });
  }

  freeColour(want) {
    const used = new Set(this.room.slots.filter((s) => s.kind === 'member' || s.kind === 'bot').map((s) => s.colour));
    if (COLOURS.includes(want) && !used.has(want)) return want;
    return COLOURS.find((c) => !used.has(c)) || COLOURS[0];
  }

  // Fewer or more slots: those in use keep their places while they fit; people ahead of
  // computer players; whoever no longer has a slot watches.
  setCount(n) {
    const r = this.room;
    const members = r.slots.filter((s) => s.kind === 'member');
    const bots = r.slots.filter((s) => s.kind === 'bot');
    if (n < r.count) {
      const keep = [...members, ...bots].slice(0, n);
      r.slots = [0, 1, 2, 3, 4, 5].map((i) => keep[i] || { kind: i < n ? 'open' : 'open' });
    }
    r.count = n;
  }

  expireSoon() {
    clearTimeout(this.timers.expire);
    this.timers.expire = setTimeout(() => this.close(), EMPTY_MS);
  }

  close() {
    for (const mem of this.members.values()) {
      if (mem.ws) this.send(mem.ws, { type: 'bye', reason: 'closed' });
    }
    this.members.clear();
    this.game = null;
    clearInterval(this.timers.heartbeat);
    this.timers.heartbeat = null;
    if (this.room) this.tellLobby(true);
    this.room = null;
  }

  // ---- the master server's list ----------------------------------------------------------------
  startHeartbeat() {
    if (this.timers.heartbeat) return;
    this.timers.heartbeat = setInterval(() => this.tellLobby(), HEARTBEAT_MS);
  }

  tellLobby(closed) {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    if (!closed && this.lastTold && now - this.lastTold < 1000 && !this.timers.tellLater) {
      this.timers.tellLater = setTimeout(() => { this.timers.tellLater = null; this.tellLobby(); }, 1000);
      return;
    }
    this.lastTold = now;
    const listed = !closed && r.access !== 'invite' && [...this.members.values()].some((m) => m.connected);
    const host = this.members.get(r.host);
    const m = r.match || {};
    const entry = listed ? {
      code: r.code, name: r.name, host: host ? host.name : '', access: r.access, phase: r.phase, mode: m.mode || 'all', map: m.map,
      players: r.slots.slice(0, r.count).filter((s) => s.kind === 'member' || s.kind === 'bot').length, slots: r.count,
      people: [...this.members.values()].filter((x) => x.connected).length, created: r.created,
    } : { code: r.code, closed: true };
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('global'));
    this.ctx.waitUntil(lobby.update(entry).catch(() => {}));
  }

  // ---- the match ---------------------------------------------------------------------------------
  // The host's settings (the players as the host's page made them, in slot order: a person's with
  // their member id, a computer player's, then everyone watching), a seed, and a delay long
  // enough for the slowest connection.
  start(settings) {
    const r = this.room;
    if (r.phase !== 'lobby' || !settings || !Array.isArray(settings.players)) return;
    if (JSON.stringify(settings).length > 20000) return;
    const seats = {};
    const players = [];
    settings.players.forEach((p, i) => {
      const person = p.member && this.members.get(p.member);
      if (p.control === 'remote' && person) seats[person.id] = i;
      if (p.control === 'spectator' && person) seats[person.id] = i;
      players.push({ index: i, member: person ? person.id : null, left: p.control !== 'remote' || !person, lagging: false, watching: p.control === 'spectator' });
    });
    const humans = players.filter((p) => !p.left);
    if (!humans.length) return;
    const worst = Math.max(0, ...humans.map((p) => this.members.get(p.member).rtt || 0));
    const speed = Number(settings.speed) || 1;
    const turnMs = TURN_TICKS * FRAME_MS / speed;
    const delay = Math.max(2, Math.min(12, Math.ceil((worst + 80) / turnMs)));
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.game = { settings, seed, seats, players, delay, turnMs, next: 0, inputs: new Map(), first: new Map(), log: [], hashes: new Map(), started: Date.now() };
    r.phase = 'playing';
    this.broadcast({ type: 'start', settings, seed, seats, delay, turnTicks: TURN_TICKS });
    this.changed();
    // The first turns have nothing in them: nobody could have ordered anything yet.
    for (let n = 0; n < delay; n++) this.emit();
  }

  input(mem, m) {
    const g = this.game;
    if (!g) return;
    const p = g.seats[mem.id];
    const pl = p !== undefined ? g.players[p] : null;
    if (!pl || pl.left || pl.watching) return;
    const n = Number(m.n) | 0;
    const cmds = Array.isArray(m.c) ? m.c.slice(0, 64) : [];
    let at = n;
    if (n < g.next) {
      // Late: what they ordered goes in the next turn; and they are behind.
      at = g.next;
      pl.lagging = true;
    } else {
      pl.lagging = false;
    }
    if (at > g.next + 400) return;               // (not from a page this far ahead)
    let turn = g.inputs.get(at);
    if (!turn) g.inputs.set(at, (turn = new Map()));
    const had = turn.get(p);
    turn.set(p, had ? had.concat(cmds) : cmds);
    if (n >= g.next && !g.first.has(at)) g.first.set(at, Date.now());
    this.tryEmit();
  }

  // Send the next turn(s) whose inputs are in: all of every player who is here and keeping up,
  // or, some time after the first came, whatever there is.
  tryEmit() {
    const g = this.game;
    if (!g) return;
    for (let guard = 0; guard < 1000; guard++) {
      const n = g.next;
      const turn = g.inputs.get(n) || new Map();
      const waitFor = g.players.filter((p) => !p.left && !p.watching && !p.lagging && this.members.get(p.member) && this.members.get(p.member).connected);
      const all = waitFor.length > 0 && waitFor.every((p) => turn.has(p.index));
      const first = g.first.get(n);
      if (all || (turn.size > 0 && waitFor.length === 0)) {
        this.emit();
        continue;
      }
      if (first !== undefined && Date.now() - first >= LATE_MS) {
        for (const p of waitFor) if (!turn.has(p.index)) p.lagging = true;
        this.emit();
        continue;
      }
      if (first !== undefined && !this.timers.late) {
        this.timers.late = setTimeout(() => { this.timers.late = null; this.tryEmit(); }, Math.max(5, LATE_MS - (Date.now() - first)));
      }
      break;
    }
  }

  emit() {
    const g = this.game;
    const n = g.next;
    const turn = g.inputs.get(n) || new Map();
    const c = [];
    for (const p of [...turn.keys()].sort((a, b) => a - b)) for (const cmd of turn.get(p)) c.push([p, cmd]);
    const left = g.pendingLeft || [];
    g.pendingLeft = [];
    const bundle = left.length ? { type: 't', n, c, left } : { type: 't', n, c };
    g.log.push(bundle);
    g.inputs.delete(n);
    g.first.delete(n);
    g.next = n + 1;
    this.broadcast(bundle);
  }

  // Bundles from turn `from` on, to one member (joining late, or back after losing their
  // connection), in batches.
  resend(mem, from) {
    const g = this.game;
    if (!g || !mem.ws) return;
    for (let i = Math.max(0, from); i < g.log.length; i += 500) this.send(mem.ws, { type: 'log', bundles: g.log.slice(i, i + 500) });
  }

  leaveMatch(p) {
    const g = this.game;
    const pl = g && g.players[p];
    if (!pl || pl.left) return;
    pl.left = true;
    g.pendingLeft = (g.pendingLeft || []).concat([p]);
    // (the next bundle says so; if nobody is sending, one goes now)
    if (!g.players.some((x) => !x.left && !x.watching && this.members.get(x.member) && this.members.get(x.member).connected)) this.emit();
    else this.tryEmit();
  }

  surrender(mem) {
    const g = this.game;
    if (!g || g.seats[mem.id] === undefined) return;
    this.leaveMatch(g.seats[mem.id]);
  }

  hash(mem, m) {
    const g = this.game;
    if (!g) return;
    const p = g.seats[mem.id];
    if (p === undefined || g.players[p].watching) return;
    const n = Number(m.n) | 0;
    let row = g.hashes.get(n);
    if (!row) g.hashes.set(n, (row = new Map()));
    row.set(p, String(m.h));
    const values = new Set(row.values());
    if (values.size > 1 && !g.desynced) {
      g.desynced = n;
      this.broadcast({ type: 'desync', n, hashes: Object.fromEntries(row) });
    }
    // (only the recent past is kept)
    for (const k of g.hashes.keys()) if (k < n - 200) g.hashes.delete(k);
  }

  // The match is over (every page sees it end on the same turn): back to the lobby.
  ended(mem) {
    const r = this.room;
    if (!this.game || this.game.seats[mem.id] === undefined) return;
    this.game = null;
    r.phase = 'lobby';
    // Players who left the room during the match no longer have slots.
    r.slots.forEach((s, i) => {
      if (s.kind === 'member' && !this.members.has(s.member)) r.slots[i] = { kind: 'open' };
    });
    // Whoever watched gets a slot, if one is free.
    for (const x of this.members.values()) {
      if (r.slots.some((s) => s.kind === 'member' && s.member === x.id)) continue;
      const i = r.slots.slice(0, r.count).findIndex((s) => s.kind === 'open');
      if (i >= 0) r.slots[i] = { kind: 'member', member: x.id, faction: 'random', colour: this.freeColour() };
    }
    this.changed();
  }
}
