// The master server: every listed room (public, or with a password), one Durable Object for
// everyone.  Rooms tell it about themselves when they change and every half minute; a room
// not heard from for a while is gone.  The list is kept in the object's storage as well as
// in memory, so that it survives the object being restarted (a deploy, or Cloudflare putting
// an idle object away) rather than coming back empty until every room next reports.
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
    ctx.blockConcurrencyWhile(async () => {
      for (const [code, r] of await ctx.storage.list()) this.rooms.set(code, r);
    });
  }

  async update(entry) {
    if (!entry || !entry.code) return;
    if (entry.closed) {
      this.rooms.delete(entry.code);
      await this.ctx.storage.delete(entry.code);
    } else {
      const r = Object.assign({}, entry, { seen: Date.now() });
      this.rooms.set(entry.code, r);
      await this.ctx.storage.put(entry.code, r);
    }
  }

  async list() {
    const now = Date.now();
    const gone = [];
    for (const [code, r] of this.rooms) {
      if (now - r.seen > STALE_MS) {
        this.rooms.delete(code);
        gone.push(code);
      }
    }
    if (gone.length) await this.ctx.storage.delete(gone);
    return [...this.rooms.values()].sort((a, b) => a.created - b.created).map(({ seen, ...r }) => r);
  }
}

export async function handleLobbies(request, env) {
  const stub = env.LOBBY.get(env.LOBBY.idFromName('global'));
  return json(env, request, { rooms: await stub.list() });
}
