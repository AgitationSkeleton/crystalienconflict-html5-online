// The master server: every listed room (public, or with a password), one Durable Object for
// everyone.  Rooms tell it about themselves when they change and every half minute; a room
// not heard from for a while is gone.
//
//   GET /lobbies        {rooms: [{code, name, host, access, phase, mode, map, players, slots,
//                        people, created}]}

import { DurableObject } from 'cloudflare:workers';
import { json } from './http.js';

const STALE_MS = 75000;

export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rooms = new Map();
  }

  async update(entry) {
    if (!entry || !entry.code) return;
    if (entry.closed) this.rooms.delete(entry.code);
    else this.rooms.set(entry.code, Object.assign({}, entry, { seen: Date.now() }));
  }

  async list() {
    const now = Date.now();
    for (const [code, r] of this.rooms) if (now - r.seen > STALE_MS) this.rooms.delete(code);
    return [...this.rooms.values()].sort((a, b) => a.created - b.created).map(({ seen, ...r }) => r);
  }
}

export async function handleLobbies(request, env) {
  const stub = env.LOBBY.get(env.LOBBY.idFromName('global'));
  return json(env, request, { rooms: await stub.list() });
}
