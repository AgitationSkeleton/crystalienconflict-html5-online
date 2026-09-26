// CrystAlien Conflict's server: one Cloudflare Worker for both of the port's sites.
//
//   /hiscore/...        the high-score table (scores.js)
//   /lobbies            the online game's master server: every listed room (lobby.js)
//   /rooms/...          a match room: made, joined over a WebSocket, played (room.js)
//   /health             that the server is up

import { preflight, json, text } from './http.js';
import { handleScores } from './scores.js';
import { handleLobbies } from './lobby.js';
import { handleRooms } from './room.js';

export { Lobby } from './lobby.js';
export { Room } from './room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return preflight(env, request);
    try {
      if (url.pathname.startsWith('/hiscore/')) return await handleScores(request, env, url);
      if (url.pathname === '/lobbies' || url.pathname.startsWith('/lobbies/')) return await handleLobbies(request, env, url);
      if (url.pathname === '/rooms' || url.pathname.startsWith('/rooms/')) return await handleRooms(request, env, url);
      if (url.pathname === '/health') return json(env, request, { ok: true, time: Date.now() });
      if (url.pathname === '/') return text(env, request, 'CrystAlien Conflict server. The game is at https://caconline.viosarcade.xyz/\n');
      return json(env, request, { error: 'not found' }, 404);
    } catch (e) {
      return json(env, request, { error: 'server', message: String(e && e.message || e) }, 500);
    }
  },
};
