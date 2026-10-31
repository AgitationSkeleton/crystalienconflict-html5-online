// Custom maps: the ones players share from the game's map editor (src/online/custom.js), kept in
// D1, each looked at by the owner in Discord before anyone else sees it (mapbot.js).
//
// A map is data only (src/online/cacmap.js, which the game and this server share): validate()
// keeps only what the format knows, in range, and the game checks it again on download.  Every
// query is a prepared statement with bound values.  Names and descriptions go through the
// profanity filter, and are refused, not starred, when they hold something.  A player is an
// "author key" their game made at random (32 hex digits), kept on their device; the server keeps
// only a hash of it.  Addresses are kept hashed, for limits and bans.
//
//   GET    /maps?kind=&sort=new|likes|plays&q=&page=&key=   approved maps, 24 a page, each with
//                                                      its data (the game draws its card from
//                                                      it); with key, which the player likes
//   GET    /maps/mine?key=                             the author's own, any status
//   GET    /maps/ID?key=                               one map, with its data (approved, or the
//                                                      author's own), and whether they like it
//   GET    /maps/ID/preview.png                        its picture: the game's, sent with it,
//                                                      or else the map's plain colours
//   POST   /maps            {key, author, map, sig, id?, thumb?} share a map (or a new version
//                                                      of one's own); map is the cacmap as JSON
//                                                      text, sig the game's hash of it, thumb its
//                                                      picture as the game drew it (base64 JPEG
//                                                      or PNG: picture.js)
//   DELETE /maps/ID?key=                               take one's own down
//   POST   /maps/ID/like    {key, like}                like it, or not any more
//   POST   /maps/ID/play    {key}                      played (once a player)
//   GET    /maps/ID/scores                             a singleplayer map's best: quickest, then
//                                                      the most money left
//   POST   /maps/ID/score   {key, name, seconds, cash, version, sig}
//
// and for the owner, with ADMIN_KEY (as for the scores; Discord is the usual way, mapbot.js):
//
//   GET    /maps/admin/pending
//   POST   /maps/admin/ID   {action: 'approve' | 'reject' | 'remove' | 'ban'}

import { json, text, sha1Hex, sha256Hex, clientIp, cleanName, decentName } from './http.js';
import { censor, isClean } from '../../src/online/profanity.js';
import { validate, previewPixels } from '../../src/online/cacmap.js';
import { encodePng } from './png.js';
import { postForReview } from './mapbot.js';
import { checkPicture } from './picture.js';

const ID = /^[a-z0-9]{10}$/;
const KEY = /^[a-f0-9]{32}$/;
const PAGE = 24;
const MAX_BODY = 700000;
// (a map's columns but its picture, which is only for preview.png and the review post)
const COLS = 'id, author, author_name, kind, name, descr, w, h, players, data, status, version, likes, plays, created, updated, ip_hash, message_id';
export const DEFAULTS = { autoapprove: '0', uploads: 'on', per_day: '5' };

export async function config(env) {
  const { results } = await env.DB.prepare('SELECT k, v FROM map_config').all();
  const out = Object.assign({}, DEFAULTS);
  for (const r of results || []) out[r.k] = r.v;
  return out;
}

export async function setConfig(env, k, v) {
  await env.DB.prepare('INSERT INTO map_config (k, v) VALUES (?1, ?2) ON CONFLICT (k) DO UPDATE SET v = ?2').bind(k, String(v)).run();
}

// An author key's hash: who they are, to this server.
export async function authorOf(key) {
  return KEY.test(String(key || '')) ? (await sha256Hex('author|' + key)).slice(0, 32) : null;
}

async function ipHashOf(env, request) {
  return (await sha256Hex(env.SCORE_SECRET + '|' + clientIp(request))).slice(0, 32);
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

async function body(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
}

// What a list shows of a map (no map data).
function card(r) {
  return { id: r.id, name: r.name, desc: r.descr, kind: r.kind, w: r.w, h: r.h, players: r.players, author: r.author_name,
    likes: r.likes, plays: r.plays, version: r.version, created: r.created, updated: r.updated, status: r.status, map: JSON.parse(r.data) };
}

export async function banned(env, author, ipHash) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM map_bans WHERE who = ?1 OR who = ?2').bind(author || '-', 'ip:' + ipHash).first();
  return !!(r && r.n);
}

export async function handleMaps(request, env, url, ctx) {
  const parts = url.pathname.split('/').filter(Boolean);     // ['maps', ...]
  const method = request.method;
  if (parts[1] === 'admin') return admin(request, env, parts, ctx);
  if (parts.length === 1 && method === 'GET') return list(request, env, url);
  if (parts.length === 1 && method === 'POST') return upload(request, env, ctx);
  if (parts.length === 2 && parts[1] === 'mine' && method === 'GET') {
    const author = await authorOf(url.searchParams.get('key'));
    if (!author) return json(env, request, { error: 'key' }, 400);
    const { results } = await env.DB.prepare(`SELECT ${COLS} FROM maps WHERE author = ?1 AND status != 'removed' ORDER BY updated DESC LIMIT 100`).bind(author).all();
    return json(env, request, { maps: (results || []).map(card) });
  }
  const id = parts[1];
  if (!ID.test(String(id || ''))) return json(env, request, { error: 'not found' }, 404);
  const row = await env.DB.prepare(`SELECT ${COLS} FROM maps WHERE id = ?1`).bind(id).first();
  if (!row || row.status === 'removed') return json(env, request, { error: 'not found' }, 404);
  if (parts.length === 2 && method === 'GET') {
    const author = await authorOf(url.searchParams.get('key'));
    if (row.status !== 'approved' && row.author !== author) return json(env, request, { error: 'not found' }, 404);
    const liked = author ? await env.DB.prepare('SELECT 1 AS y FROM map_likes WHERE map = ?1 AND author = ?2').bind(id, author).first() : null;
    return json(env, request, Object.assign(card(row), { map: JSON.parse(row.data), liked: !!liked, mine: row.author === author }));
  }
  if (parts.length === 2 && method === 'DELETE') {
    const author = await authorOf(url.searchParams.get('key'));
    if (!author || row.author !== author) return json(env, request, { error: 'not yours' }, 403);
    await env.DB.prepare("UPDATE maps SET status = 'removed', updated = ?2 WHERE id = ?1").bind(id, Date.now()).run();
    return json(env, request, { ok: true });
  }
  if (parts[2] === 'preview.png' && method === 'GET') {
    const pic = await env.DB.prepare('SELECT thumb, thumb_type FROM maps WHERE id = ?1').bind(id).first();
    const headers = { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
    if (pic && pic.thumb && /^image\/(jpeg|png)$/.test(pic.thumb_type || '')) {
      return new Response(new Uint8Array(pic.thumb), { headers: Object.assign({ 'Content-Type': pic.thumb_type }, headers) });
    }
    const map = JSON.parse(row.data);
    const scale = Math.max(1, Math.min(4, Math.floor(512 / (2 * Math.max(map.w, map.h)))));
    const [w, h, px] = previewPixels(map, scale);
    return new Response(await encodePng(w, h, new Uint8Array(px.buffer)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } });
  }
  if (row.status !== 'approved') return json(env, request, { error: 'not found' }, 404);
  if (parts[2] === 'scores' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT name, seconds, cash, created FROM map_scores WHERE map = ?1 AND version = ?2 ORDER BY seconds ASC, cash DESC, created ASC LIMIT 20')
      .bind(id, row.version).all();
    return json(env, request, { scores: (results || []).map((r) => Object.assign(r, { name: censor(r.name) })) });
  }
  if (method !== 'POST') return json(env, request, { error: 'not found' }, 404);
  const b = await body(request);
  const author = b && await authorOf(b.key);
  if (!author) return json(env, request, { error: 'key' }, 400);
  if (parts[2] === 'like') {
    if (b.like) await env.DB.prepare('INSERT OR IGNORE INTO map_likes (map, author, created) VALUES (?1, ?2, ?3)').bind(id, author, Date.now()).run();
    else await env.DB.prepare('DELETE FROM map_likes WHERE map = ?1 AND author = ?2').bind(id, author).run();
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM map_likes WHERE map = ?1').bind(id).first();
    await env.DB.prepare('UPDATE maps SET likes = ?2 WHERE id = ?1').bind(id, n.n).run();
    return json(env, request, { likes: n.n, liked: !!b.like });
  }
  if (parts[2] === 'play') {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO map_plays (map, author, created) VALUES (?1, ?2, ?3)').bind(id, author, Date.now()).run();
    if (r.meta && r.meta.changes) await env.DB.prepare('UPDATE maps SET plays = plays + 1 WHERE id = ?1').bind(id).run();
    return json(env, request, { ok: true });
  }
  if (parts[2] === 'score') {
    if (row.kind !== 'story') return json(env, request, { error: 'not a singleplayer map' }, 400);
    const seconds = Number(b.seconds), cash = Number(b.cash);
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 86400 || !Number.isInteger(cash) || cash < 0 || cash > 100000000) return json(env, request, { error: 'score' }, 400);
    if (Number(b.version) !== row.version) return json(env, request, { error: 'an older version of the map' }, 409);
    if (String(b.sig || '') !== await sha1Hex(env.SCORE_SECRET + 'SaveMapScore' + id + seconds + '|' + cash)) return json(env, request, { error: 'sig' }, 403);
    const given = cleanName(b.name);
    const name = given && censor(given);
    if (!name || !decentName(name)) return json(env, request, { error: 'name' }, 400);
    // (one row a player, their best: the quickest, then the most money left)
    await env.DB.prepare(`INSERT INTO map_scores (map, author, name, seconds, cash, version, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT (map, author) DO UPDATE SET name = ?3, seconds = ?4, cash = ?5, version = ?6, created = ?7
      WHERE map_scores.version != ?6 OR ?4 < map_scores.seconds OR (?4 = map_scores.seconds AND ?5 > map_scores.cash)`)
      .bind(id, author, name, seconds, cash, row.version, Date.now()).run();
    return json(env, request, { ok: true });
  }
  return json(env, request, { error: 'not found' }, 404);
}

async function list(request, env, url) {
  const kind = url.searchParams.get('kind');
  const sort = { likes: 'likes DESC, created DESC', plays: 'plays DESC, created DESC' }[url.searchParams.get('sort')] || 'created DESC';
  const q = String(url.searchParams.get('q') || '').slice(0, 32).toLowerCase();
  const page = Math.max(0, Math.min(200, Number(url.searchParams.get('page')) | 0));
  const k = kind === 'skirmish' || kind === 'story' ? kind : '';
  // (the order is one of the two above, never what was sent)
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM maps WHERE status = 'approved' AND (?1 = '' OR kind = ?1) AND (?2 = '' OR instr(lower(name), ?2) > 0 OR instr(lower(author_name), ?2) > 0)
    ORDER BY ${sort} LIMIT ?3 OFFSET ?4`).bind(k, q, PAGE + 1, page * PAGE).all();
  const rows = (results || []).slice(0, PAGE);
  const author = await authorOf(url.searchParams.get('key'));
  const liked = new Set();
  if (author && rows.length) {
    const ids = rows.map((r) => r.id);
    const { results: likes } = await env.DB.prepare('SELECT map FROM map_likes WHERE author = ?1 AND map IN (' + ids.map((_, i) => '?' + (i + 2)).join(', ') + ')').bind(author, ...ids).all();
    for (const l of likes || []) liked.add(l.map);
  }
  return json(env, request, { maps: rows.map((r) => Object.assign(card(r), { liked: liked.has(r.id) })), more: (results || []).length > PAGE });
}

async function upload(request, env, ctx) {
  const b = await body(request);
  if (!b || typeof b.map !== 'string') return json(env, request, { error: 'map' }, 400);
  const author = await authorOf(b.key);
  if (!author) return json(env, request, { error: 'key' }, 400);
  // (made by the game: its hash of the map, as for its scores)
  if (String(b.sig || '') !== await sha1Hex(env.SCORE_SECRET + 'SaveMap' + b.map)) return json(env, request, { error: 'sig' }, 403);
  const cfg = await config(env);
  if (cfg.uploads === 'off') return json(env, request, { error: 'Sharing maps is closed for now.' }, 403);
  const ipHash = await ipHashOf(env, request);
  if (await banned(env, author, ipHash)) return json(env, request, { error: 'You cannot share maps.' }, 403);
  let input;
  try {
    input = JSON.parse(b.map);
  } catch (e) {
    return json(env, request, { error: 'map' }, 400);
  }
  const v = validate(input);
  if (!v.ok) return json(env, request, { error: 'The map is not right: ' + v.errors.join('; ') }, 400);
  const pic = b.thumb === undefined ? null : checkPicture(b.thumb);
  if (b.thumb !== undefined && !pic) return json(env, request, { error: 'The map\'s picture is not right.' }, 400);
  const map = v.map;
  const authorName = cleanName(b.author);
  if (!map.name) return json(env, request, { error: 'The map needs a name.' }, 400);
  for (const [what, s] of [['name', map.name], ['description', map.desc], ['author name', authorName || '']]) {
    if (!isClean(s) || !decentName(s)) return json(env, request, { error: 'Please choose another ' + what + '.' }, 400);
  }
  if (!authorName) return json(env, request, { error: 'Your name, please (the settings).' }, 400);
  const now = Date.now();
  const perDay = Number(cfg.per_day);
  if (cfg.per_day !== 'off' && Number.isFinite(perDay)) {
    // (each player so many, and each address three times that: people may share one)
    const r = await env.DB.prepare('SELECT SUM(author = ?1) AS mine, SUM(ip_hash = ?2) AS here FROM map_uploads WHERE created > ?3').bind(author, ipHash, now - 86400000).first();
    if (r && (r.mine >= perDay || r.here >= 3 * perDay)) return json(env, request, { error: 'That is as many as you can share in a day (' + perDay + ').' }, 429);
  }
  const status = cfg.autoapprove === '1' ? 'approved' : 'pending';
  const players = map.kind === 'skirmish' ? map.bases.length : 1;
  const data = JSON.stringify(map);
  let id = b.id;
  let version = 1;
  if (id !== undefined) {
    const old = ID.test(String(id)) && await env.DB.prepare('SELECT author, version, status FROM maps WHERE id = ?1').bind(id).first();
    if (!old || old.author !== author || old.status === 'removed') return json(env, request, { error: 'not yours' }, 403);
    version = old.version + 1;
    await env.DB.prepare(`UPDATE maps SET author_name = ?2, kind = ?3, name = ?4, descr = ?5, w = ?6, h = ?7, players = ?8, data = ?9, status = ?10, version = ?11,
      updated = ?12, ip_hash = ?13, message_id = NULL, thumb = ?14, thumb_type = ?15 WHERE id = ?1`)
      .bind(id, authorName, map.kind, map.name, map.desc, map.w, map.h, players, data, status, version, now, ipHash, pic ? pic.bytes : null, pic ? pic.type : null).run();
  } else {
    id = newId();
    await env.DB.prepare(`INSERT INTO maps (id, author, author_name, kind, name, descr, w, h, players, data, status, version, likes, plays, created, updated, ip_hash, thumb, thumb_type)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, 0, 0, ?12, ?12, ?13, ?14, ?15)`)
      .bind(id, author, authorName, map.kind, map.name, map.desc, map.w, map.h, players, data, status, now, ipHash, pic ? pic.bytes : null, pic ? pic.type : null).run();
  }
  await env.DB.prepare('INSERT INTO map_uploads (map, author, ip_hash, created) VALUES (?1, ?2, ?3, ?4)').bind(id, author, ipHash, now).run();
  const row = await env.DB.prepare('SELECT * FROM maps WHERE id = ?1').bind(id).first();
  const post = postForReview(env, row).catch((e) => console.log('mapbot: ' + (e && e.stack || e)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(post);
  return json(env, request, { id, version, status });
}

// What the owner decides of a map (Discord's reactions and commands, or the admin endpoint).
export async function moderate(env, id, action) {
  const row = await env.DB.prepare('SELECT * FROM maps WHERE id = ?1').bind(id).first();
  if (!row) return null;
  const now = Date.now();
  const status = { approve: 'approved', reject: 'rejected', remove: 'removed', ban: 'rejected' }[action];
  if (!status) return null;
  await env.DB.prepare('UPDATE maps SET status = ?2, updated = ?3 WHERE id = ?1').bind(id, status, now).run();
  if (action === 'ban') {
    await env.DB.prepare('INSERT OR IGNORE INTO map_bans (who, created, note) VALUES (?1, ?2, ?3)').bind(row.author, now, row.author_name).run();
    if (row.ip_hash) await env.DB.prepare('INSERT OR IGNORE INTO map_bans (who, created, note) VALUES (?1, ?2, ?3)').bind('ip:' + row.ip_hash, now, row.author_name).run();
    await env.DB.prepare("UPDATE maps SET status = 'rejected', updated = ?2 WHERE author = ?1 AND status = 'pending'").bind(row.author, now).run();
  }
  return Object.assign(row, { status });
}

async function admin(request, env, parts, ctx) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.ADMIN_KEY || auth !== 'Bearer ' + env.ADMIN_KEY) return json(env, request, { error: 'unauthorised' }, 401);
  if (parts[2] === 'pending' && request.method === 'GET') {
    const { results } = await env.DB.prepare("SELECT * FROM maps WHERE status = 'pending' ORDER BY updated ASC LIMIT 100").all();
    return json(env, request, { maps: (results || []).map(card) });
  }
  if (ID.test(String(parts[2] || '')) && request.method === 'POST') {
    const b = await body(request);
    const row = b && await moderate(env, parts[2], b.action);
    return row ? json(env, request, { id: row.id, status: row.status }) : json(env, request, { error: 'action' }, 400);
  }
  return text(env, request, 'not found', 404);
}
