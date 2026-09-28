// The server's log for its owner: a message to a Discord channel's webhook for each thing worth
// knowing -- a room made, its match started and over, a desync, the room closed, a high score
// saved.  The webhook is the DISCORD_WEBHOOK secret (`wrangler secret put DISCORD_WEBHOOK`),
// never in the repository, which is public: whoever has it can post to the channel.  Without
// it nothing is sent.  A message that fails (Discord down, or too many at once) is let go: the
// game never waits on it.

const MODES = { all: 'Destroy All', structures: 'Destroy Structures', hq: 'Destroy HQs', pizza: 'Pizza Mode', ctf: 'Capture the Flag', hero: 'Hunt the Hero' };

// Players' names and rooms' names as they are, not as Discord's formatting would take them.
export function plain(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/[\\*_~`|>#[\]()<:@-]/g, '\\$&').slice(0, 100);
}

export function modeName(mode) {
  return MODES[mode] || MODES.all;
}

export function mapName(map) {
  if (map === undefined || map === null || map === '') return 'Eclipse';
  return String(map) === '10' ? 'Eclipse' : String(map);
}

// How long, for people: "12 min", "1 h 5 min", "40 s".
export function lasted(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

// Which of the port's sites a request came from.
export function siteOf(request) {
  const origin = (request && request.headers.get('Origin')) || '';
  if (origin.includes('caconline.')) return 'the online site';
  if (origin.includes('cac.')) return 'the classic site';
  if (origin.startsWith('app:')) return 'the app';
  if (/localhost|127\.0\.0\.1/.test(origin)) return 'a local test';
  return 'an unknown page';
}

// One message.  ctx: whatever can keep the Worker (or the Durable Object) running until it is
// sent -- its waitUntil.
export function discord(env, ctx, text) {
  if (!env || !env.DISCORD_WEBHOOK) return;
  const send = fetch(env.DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // (no one is pinged, whatever a name says)
    body: JSON.stringify({ username: 'CrystAlien Conflict server', content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } }),
  }).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(send);
}
