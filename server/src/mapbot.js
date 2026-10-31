// Custom maps' review in Discord: each map shared (maps.js) is posted to the owner's channel with
// its picture, and the owner decides by reacting -- ✅ approve, ❌ reject, 🔨 reject and ban its
// author -- or by typing commands there (!maps help).  Only MAPS_OWNER's reactions and commands
// count.
//
// It is the Alien Commander bot's token (the DISCORD_BOT_TOKEN secret, never in the repository),
// used only through Discord's REST API: the bot's own program, which keeps a gateway connection
// for its other work, is not touched.  So nothing is pushed to the server: a cron trigger looks
// at the channel once a minute (scheduled, index.js).

import { encodePng } from './png.js';
import { previewPixels } from '../../src/online/cacmap.js';
import { plain } from './discord.js';
import { config, setConfig, moderate, DEFAULTS } from './maps.js';

const API = 'https://discord.com/api/v10';
const REACTIONS = { '✅': 'approve', '❌': 'reject', '\u{1F528}': 'ban' };
const KINDS = { skirmish: 'Skirmish', story: 'Singleplayer' };
const WINS = { all: 'Destroy everything', buildings: 'Destroy the buildings', hq: 'Destroy the HQ', infiltrate: 'Infiltrate a building',
  protect: 'Protect something', collect: 'Collect items', survive: 'Survive' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ready(env) {
  return !!(env.DISCORD_BOT_TOKEN && env.MAPS_CHANNEL && env.MAPS_OWNER);
}

async function api(env, method, path, body, form) {
  const headers = { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'User-Agent': 'CrystAlienConflictServer (https://caconline.viosarcade.xyz, 1)' };
  if (body && !form) headers['Content-Type'] = 'application/json';
  for (let tries = 0; tries < 3; tries++) {
    const r = await fetch(API + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
    if (r.status === 429) {
      const wait = Number((await r.json().catch(() => ({}))).retry_after) || 1;
      await sleep(Math.min(5, wait) * 1000 + 100);
      continue;
    }
    // (what went wrong, in the Worker's log: wrangler tail, or the dashboard's)
    if (!r.ok) {
      console.log('discord ' + method + ' ' + path.replace(/\?.*/, '') + ': ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 300));
      return null;
    }
    return r.status === 204 ? {} : r.json().catch(() => ({}));
  }
  return null;
}

function describe(row, map) {
  const fields = [
    { name: 'Kind', value: KINDS[row.kind] || row.kind, inline: true },
    { name: 'Size', value: row.w + ' × ' + row.h, inline: true },
    row.kind === 'skirmish' ? { name: 'Players', value: String(row.players), inline: true }
      : { name: 'Goal', value: WINS[map.story && map.story.win.k] || '?', inline: true },
    { name: 'Author', value: plain(row.author_name) + ' (`' + row.author.slice(0, 8) + '`)', inline: true },
    { name: 'Map', value: '`' + row.id + '`' + (row.version > 1 ? ' version ' + row.version : ''), inline: true },
  ];
  return { title: plain(row.name).slice(0, 200), description: row.descr ? plain(row.descr) : undefined, color: 0x6fd12a, fields,
    image: { url: 'attachment://preview.png' }, footer: { text: 'React ✅ approve · ❌ reject · \u{1F528} reject and ban the author · !maps help' } };
}

// A map, posted for the owner to look at (or, approved by itself, for them to know of).
export async function postForReview(env, row) {
  if (!ready(env)) return;
  const map = JSON.parse(row.data);
  const scale = Math.max(1, Math.min(4, Math.floor(512 / (2 * Math.max(map.w, map.h)))));
  const [w, h, px] = previewPixels(map, scale);
  const png = await encodePng(w, h, new Uint8Array(px.buffer));
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content: row.status === 'approved' ? '\u{1F5FA}️ **A map was shared** (approved by itself: autoapprove is on)' : '\u{1F5FA}️ **A map to look at**',
    embeds: [describe(row, map)], allowed_mentions: { parse: [] }, attachments: [{ id: 0, filename: 'preview.png' }],
  }));
  form.append('files[0]', new Blob([png], { type: 'image/png' }), 'preview.png');
  const msg = await api(env, 'POST', '/channels/' + env.MAPS_CHANNEL + '/messages', null, form);
  if (!msg || !msg.id) return;
  await env.DB.prepare('UPDATE maps SET message_id = ?2 WHERE id = ?1').bind(row.id, msg.id).run();
  for (const emoji of Object.keys(REACTIONS)) {
    await api(env, 'PUT', '/channels/' + env.MAPS_CHANNEL + '/messages/' + msg.id + '/reactions/' + encodeURIComponent(emoji) + '/@me');
    await sleep(300);
  }
}

async function say(env, text, replyTo) {
  return api(env, 'POST', '/channels/' + env.MAPS_CHANNEL + '/messages', { content: String(text).slice(0, 1900), allowed_mentions: { parse: [] },
    message_reference: replyTo ? { message_id: replyTo, fail_if_not_exists: false } : undefined });
}

// What was decided, on the map's post.
async function mark(env, row, what) {
  if (!row.message_id) return;
  const words = { approved: '✅ **Approved**', rejected: '❌ **Rejected**', removed: '\u{1F5D1}️ **Taken down**', banned: '\u{1F528} **Rejected, and its author banned**' };
  await api(env, 'PATCH', '/channels/' + env.MAPS_CHANNEL + '/messages/' + row.message_id, { content: words[what] || what });
}

async function decide(env, id, action) {
  const row = await moderate(env, id, action);
  if (row) await mark(env, row, action === 'ban' ? 'banned' : row.status);
  return row;
}

// The maps waiting: has the owner reacted to any?
async function reactions(env) {
  const { results } = await env.DB.prepare("SELECT id, message_id FROM maps WHERE message_id IS NOT NULL AND status IN ('pending', 'approved') AND updated > ?1 ORDER BY updated DESC LIMIT 15")
    .bind(Date.now() - 30 * 86400000).all();
  for (const row of results || []) {
    const msg = await api(env, 'GET', '/channels/' + env.MAPS_CHANNEL + '/messages/' + row.message_id);
    if (!msg) continue;
    // (the bot's own reaction is one of each; the most serious of the owner's counts)
    for (const emoji of ['\u{1F528}', '❌', '✅']) {
      const r = (msg.reactions || []).find((x) => x.emoji && x.emoji.name === emoji);
      if (!r || r.count <= (r.me ? 1 : 0)) continue;
      const users = await api(env, 'GET', '/channels/' + env.MAPS_CHANNEL + '/messages/' + row.message_id + '/reactions/' + encodeURIComponent(emoji) + '?limit=100');
      if (!(users || []).some((u) => u.id === env.MAPS_OWNER)) continue;
      const now = await env.DB.prepare('SELECT status FROM maps WHERE id = ?1').bind(row.id).first();
      const action = REACTIONS[emoji];
      if (action === 'approve' && now.status === 'approved') break;
      await decide(env, row.id, action);
      if (action !== 'approve') await env.DB.prepare('UPDATE maps SET message_id = NULL WHERE id = ?1').bind(row.id).run();
      break;
    }
  }
}

const HELP = [
  '**!maps** commands (only yours count):',
  '`!maps status` — the settings, and how many maps',
  '`!maps pending` — the maps waiting',
  '`!maps approve ID` · `!maps reject ID` · `!maps remove ID` (take an approved one down)',
  '`!maps ban ID|AUTHOR` — ban a map\'s author (and the address it came from), or an author by the 8 characters on a post',
  '`!maps unban AUTHOR` · `!maps bans`',
  '`!maps autoapprove on|off` — maps go up without waiting for you',
  '`!maps uploads on|off` — sharing maps open or closed',
  '`!maps limit N|off` — how many maps a player (or an address) may share a day, or no limit',
].join('\n');

async function command(env, text) {
  const [, verb = 'help', arg = '', ...rest] = text.trim().split(/\s+/);
  const db = env.DB;
  const id = arg.toLowerCase();
  switch (verb.toLowerCase()) {
    case 'status': {
      const cfg = await config(env);
      const counts = await db.prepare("SELECT SUM(status = 'pending') AS p, SUM(status = 'approved') AS a, SUM(status = 'rejected') AS r FROM maps").first();
      const bans = await db.prepare('SELECT COUNT(*) AS n FROM map_bans').first();
      return `autoapprove **${cfg.autoapprove === '1' ? 'on' : 'off'}** · uploads **${cfg.uploads}** · limit **${cfg.per_day === 'off' ? 'off' : cfg.per_day + ' a day'}**\n` +
        `${counts.p || 0} waiting, ${counts.a || 0} approved, ${counts.r || 0} rejected · ${bans.n} bans`;
    }
    case 'pending': {
      const { results } = await db.prepare("SELECT id, name, author_name, kind FROM maps WHERE status = 'pending' ORDER BY updated ASC LIMIT 25").all();
      return (results || []).length ? (results || []).map((r) => '`' + r.id + '` ' + plain(r.name) + ' — ' + plain(r.author_name) + ' (' + KINDS[r.kind] + ')').join('\n') : 'Nothing waiting.';
    }
    case 'approve': case 'reject': case 'remove': {
      const row = /^[a-z0-9]{10}$/.test(id) && await decide(env, id, verb.toLowerCase());
      return row ? '`' + id + '` ' + plain(row.name) + ': ' + row.status + '.' : 'No map `' + plain(arg) + '`.';
    }
    case 'ban': {
      if (/^[a-z0-9]{10}$/.test(id)) {
        const row = await decide(env, id, 'ban');
        if (row) return 'Banned ' + plain(row.author_name) + ' (`' + row.author.slice(0, 8) + '`); `' + id + '` rejected.';
      }
      if (/^[a-f0-9]{8}$/.test(id)) {
        const who = await db.prepare('SELECT author, author_name FROM maps WHERE substr(author, 1, 8) = ?1 LIMIT 1').bind(id).first();
        if (who) {
          await db.prepare('INSERT OR IGNORE INTO map_bans (who, created, note) VALUES (?1, ?2, ?3)').bind(who.author, Date.now(), who.author_name).run();
          await db.prepare("UPDATE maps SET status = 'rejected', updated = ?2 WHERE author = ?1 AND status = 'pending'").bind(who.author, Date.now()).run();
          return 'Banned ' + plain(who.author_name) + ' (`' + id + '`).';
        }
      }
      return 'No map or author `' + plain(arg) + '`.';
    }
    case 'unban': {
      if (!/^[a-f0-9]{8}$/.test(id)) return 'Unban by the author\'s 8 characters (`!maps bans`).';
      const who = await db.prepare('SELECT author, ip_hash FROM maps WHERE substr(author, 1, 8) = ?1').bind(id).all();
      let n = 0;
      for (const w of who.results || []) {
        n += (await db.prepare('DELETE FROM map_bans WHERE who = ?1 OR who = ?2').bind(w.author, 'ip:' + w.ip_hash).run()).meta.changes || 0;
      }
      n += (await db.prepare('DELETE FROM map_bans WHERE substr(who, 1, 8) = ?1').bind(id).run()).meta.changes || 0;
      return n ? 'Unbanned `' + id + '`.' : 'No ban for `' + id + '`.';
    }
    case 'bans': {
      const { results } = await db.prepare("SELECT who, note, created FROM map_bans WHERE who NOT LIKE 'ip:%' ORDER BY created DESC LIMIT 25").all();
      return (results || []).length ? (results || []).map((r) => '`' + r.who.slice(0, 8) + '` ' + plain(r.note || '')).join('\n') : 'Nobody is banned.';
    }
    case 'autoapprove': case 'uploads': {
      if (arg !== 'on' && arg !== 'off') return '`!maps ' + verb + ' on` or `off`.';
      await setConfig(env, verb.toLowerCase(), verb.toLowerCase() === 'autoapprove' ? (arg === 'on' ? '1' : '0') : arg);
      return verb.toLowerCase() + ' ' + arg + '.';
    }
    case 'limit': {
      if (arg === 'off') { await setConfig(env, 'per_day', 'off'); return 'No limit on sharing maps.'; }
      const n = Number(arg);
      if (!Number.isInteger(n) || n < 0 || n > 1000) return '`!maps limit N` (0 to 1000) or `!maps limit off`; it is ' + DEFAULTS.per_day + ' to begin with.';
      await setConfig(env, 'per_day', String(n));
      return 'Up to ' + n + ' maps a day each.';
    }
    default:
      return HELP;
  }
}

// The owner's new commands in the channel, since the last look.
async function commands(env) {
  const cfg = await config(env);
  const last = cfg.last_message;
  const msgs = await api(env, 'GET', '/channels/' + env.MAPS_CHANNEL + '/messages?limit=50' + (last ? '&after=' + last : ''));
  if (!Array.isArray(msgs) || !msgs.length) return;
  // (newest first from Discord; the first look only notes where the channel is)
  const newest = msgs.reduce((a, m) => (BigInt(m.id) > BigInt(a) ? m.id : a), msgs[0].id);
  await setConfig(env, 'last_message', newest);
  if (!last) return;
  for (const m of msgs.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) {
    if (!m.author || m.author.id !== env.MAPS_OWNER || !/^!maps\b/i.test(m.content || '')) continue;
    await say(env, await command(env, m.content), m.id);
  }
}

// The cron trigger's work (index.js).
export async function mapbotTick(env) {
  if (!ready(env)) return;
  await commands(env);
  await reactions(env);
}
