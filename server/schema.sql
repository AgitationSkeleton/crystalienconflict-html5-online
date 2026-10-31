-- The high-score table and custom maps (D1).  `npm run db:init` makes it on Cloudflare; `npm run db:init:local`
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

-- Custom maps (src/maps.js).  author: a hash of the player's author key; ip_hash: of the address.
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,         -- ten letters and digits
  author TEXT NOT NULL,
  author_name TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'skirmish' or 'story' (singleplayer)
  name TEXT NOT NULL,
  descr TEXT NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  players INTEGER NOT NULL,
  data TEXT NOT NULL,          -- the map (cacmap), as validate() kept it
  status TEXT NOT NULL,        -- 'pending', 'approved', 'rejected', 'removed'
  version INTEGER NOT NULL,
  likes INTEGER NOT NULL,
  plays INTEGER NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  ip_hash TEXT,
  message_id TEXT,             -- its post in the review channel
  thumb BLOB,                  -- its picture, as the game drew it (picture.js), if it came with one
  thumb_type TEXT              -- 'image/jpeg' or 'image/png'
);
CREATE INDEX IF NOT EXISTS maps_by_status ON maps (status, created DESC);
CREATE INDEX IF NOT EXISTS maps_by_author ON maps (author, updated DESC);
CREATE TABLE IF NOT EXISTS map_uploads (map TEXT NOT NULL, author TEXT NOT NULL, ip_hash TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS map_uploads_by_time ON map_uploads (created);
CREATE TABLE IF NOT EXISTS map_likes (map TEXT NOT NULL, author TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (map, author));
CREATE TABLE IF NOT EXISTS map_plays (map TEXT NOT NULL, author TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (map, author));
CREATE TABLE IF NOT EXISTS map_scores (
  map TEXT NOT NULL, author TEXT NOT NULL, name TEXT NOT NULL,
  seconds INTEGER NOT NULL, cash INTEGER NOT NULL, version INTEGER NOT NULL, created INTEGER NOT NULL,
  PRIMARY KEY (map, author)
);
CREATE TABLE IF NOT EXISTS map_bans (who TEXT PRIMARY KEY, created INTEGER NOT NULL, note TEXT);   -- an author, or 'ip:' and an address's hash
CREATE TABLE IF NOT EXISTS map_config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
