-- The high-score table (D1).  `npm run db:init` makes it on Cloudflare; `npm run db:init:local`
-- for `wrangler dev`.
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,          -- the game's gamename ("CrystAlienConflict")
  name TEXT NOT NULL,          -- as the player typed it (the table shows it upper-cased)
  score INTEGER NOT NULL,      -- Math.round(300000000 / frames taken): faster is higher
  created INTEGER NOT NULL,    -- milliseconds since 1970
  ip_hash TEXT NOT NULL        -- for rate limiting; not the address itself
);
CREATE INDEX IF NOT EXISTS scores_by_game ON scores (game, score DESC);
CREATE INDEX IF NOT EXISTS scores_by_ip ON scores (ip_hash, created);
