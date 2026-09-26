// The master server: every listed room (public, or with a password), one Durable Object for
// everyone.  Rooms tell it about themselves when they change and every 15 s; a room not
// heard from for a while is asked whether it is still there, and one silent for longer is gone.  The list is kept in the object's storage as well as
// in memory, so that it survives the object being restarted (a deploy, or Cloudflare putting
// an idle object away) rather than coming back empty until every room next reports.
//
//   GET /lobbies        {rooms: [{code, name, host, access, phase, mode, map, players, slots,
//                        people, created}]}

import { DurableObject } from 'cloudflare:workers';
import { json } from './http.js';

const STALE_MS = 45000;          // (rooms report every 15 s)
const CHECK_MS = 20000;          // a room not heard from for this long is asked if it is there

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
    const asked = [];
    for (const [code, r] of this.rooms) {
      if (now - r.seen > STALE_MS) {
        gone.push(code);
      } else if (now - r.seen > CHECK_MS && now - (r.asked || 0) > CHECK_MS) {
        // (a room that has missed its report is asked whether it is still there: one that lost
        // itself -- restarted by a deploy, say -- would stay listed till it went stale)
        r.asked = now;
        const stub = this.env.ROOM.get(this.env.ROOM.idFromName(code));
        asked.push(stub.info().then((info) => { if (!info || !info.exists) gone.push(code); }, () => {}));
      }
    }
    await Promise.all(asked);
    for (const code of gone) this.rooms.delete(code);
    if (gone.length) await this.ctx.storage.delete(gone);
    return [...this.rooms.values()].sort((a, b) => a.created - b.created).map(({ seen, asked, ...r }) => r);
  }
}

export async function handleLobbies(request, env) {
  const stub = env.LOBBY.get(env.LOBBY.idFromName('global'));
  return json(env, request, { rooms: await stub.list() });
}
