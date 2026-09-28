# CrystAlien Conflict server

One Cloudflare Worker for both of the port's sites:

- **High scores** (`/hiscore/...`): the original game's Conflict-mode table, for the 1:1 port
  (cac.viosarcade.xyz) and the online version alike. Scores live in a D1 (SQLite) database.
- **Master server** (`/lobbies`): the list of online games, kept by one Durable Object.
- **Match rooms** (`/rooms/...`): a Durable Object for each game, holding its lobby and relaying
  its match between the players' browsers over WebSockets (deterministic lockstep; see
  `src/room.js`).

Its address is **https://cacserver.viosarcade.xyz**; both sites use it by default
(`src/hiscore.js` and `src/online/net.js`; `?server=URL` on a page points it at another).

## Deploying it (once)

You need the Cloudflare account that has the `viosarcade.xyz` zone, and Node.js 20 or newer.

```
cd server
npm install
npx wrangler login                       # opens the browser to sign in to Cloudflare
npx wrangler d1 create crystalien        # prints a database_id
```

Put that `database_id` into `wrangler.jsonc` (in place of the zeros; if wrangler offers to add
it for you, it adds a second binding instead: keep the one called `DB`), then:

```
npm run db:init                          # makes the scores table in the database
npx wrangler secret put ADMIN_KEY        # the NAME is ADMIN_KEY; it then asks for the password
npx wrangler secret put DISCORD_WEBHOOK  # optional: a Discord channel's webhook, for the log below
npm run deploy
```

With `DISCORD_WEBHOOK` set, the server posts to that channel (src/discord.js): a room made (once
its maker is in it), each match started (how many play, people and computers, the map and mode)
and over, a desync, the room closed, and each high score saved (its place on the table, and which
site sent it).  The webhook is a secret, never in this repository: anyone who has it can post to
the channel.  Without it nothing is sent.

A Cloudflare account that has never had a Worker has no `workers.dev` subdomain, and the first
deploy fails asking for one (code 10063): open Workers & Pages in the dashboard once, and deploy
again. (This account's is `viosarcade`.)

`deploy` makes the Worker, its two Durable Objects, and the address `cacserver.viosarcade.xyz`
with its certificate (it can take a few minutes the first time). Check it at
https://cacserver.viosarcade.xyz/health, which answers `{"ok":true,...}`.

It is deployed (2026-09-26). Both sites already point there. Later changes to the server are just
`npm run deploy` again.

Everything fits Cloudflare's free plan: D1 and SQLite-backed Durable Objects are included, and a
match sends about ten small messages a second per player.

## The high-score table

- `GET /hiscore/GetScores?gamename=CrystAlienConflict`: the table as the game reads it (XML).
- `GET /hiscore/top?gamename=CrystAlienConflict`: the best 50, as JSON.
- `POST /hiscore/SaveScore`: what the game sends. The server checks the game's own hash, the
  name, that the score is possible (no Conflict run under five minutes), and at most ten scores an
  hour from one address.

Removing a junk entry needs the `ADMIN_KEY`:

```
curl -H "Authorization: Bearer YOUR_ADMIN_KEY" "https://cacserver.viosarcade.xyz/hiscore/admin?gamename=CrystAlienConflict"
curl -X DELETE -H "Authorization: Bearer YOUR_ADMIN_KEY" https://cacserver.viosarcade.xyz/hiscore/scores/ID
```

## Online games

- `GET /lobbies`: every listed game (public or with a password).
- `POST /rooms` `{access, password, name}`: makes a room; returns its code.
- `GET /rooms/CODE`: whether it exists (the game's list times this as the ping).
- `GET /rooms/CODE/ws`: the room itself, a WebSocket.

A room without anyone in it lasts a minute. A player who loses their connection in a match has
20 seconds to come back before they are counted as having surrendered.

## Running it locally

```
npm install
npm run db:init:local
npm run dev                              # http://127.0.0.1:8787
npm test                                 # the rooms' protocol and the scores, against it
```

Open a site with `?server=http://127.0.0.1:8787` to use it; `tools/verify/online.py` in the
online repository plays a whole match through it with two browsers.

## Changing the address

Change `routes` in `wrangler.jsonc`, and the default server in `src/hiscore.js` (in both
repositories) and `src/online/net.js`. `ALLOWED_ORIGINS` lists the pages that may use it.
