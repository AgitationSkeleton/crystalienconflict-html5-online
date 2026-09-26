// The high-score table: what LEGO's hiscore service did for the original, for the port's pages
// (docs/high-score-server.md).  The game itself talks to it, unchanged:
//
//   GET  /hiscore/GetScores?gamename=G   the table as the game reads it: XML, a row per player,
//                                        each with a score attribute and the name as its first
//                                        child's text; the best 15, one row per name.
//   POST /hiscore/SaveScore              form fields gamename, score, hash (the game's own:
//                                        SHA1(secret + "SaveScore" + gamename + score)), and the
//                                        port's username.
//
// and the table's owner, with the ADMIN_KEY secret (Authorization: Bearer ...):
//
//   GET    /hiscore/admin?gamename=G     every row, newest first, with ids (JSON)
//   DELETE /hiscore/scores/ID            remove a row

import { json, text, sha1Hex, sha256Hex, clientIp, cleanName, decentName } from './http.js';

const GAMES = /^[A-Za-z0-9_-]{1,40}$/;
// The fastest a Conflict run could plausibly be: five minutes of the game's 23 frames a second.
const MAX_SCORE = Math.round(300000000 / (5 * 60 * 23));
// Scores one address may send in an hour.
const PER_HOUR = 10;

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function top(env, game, limit = 15) {
  const { results } = await env.DB.prepare(
    `SELECT name, score FROM (
       SELECT name, score, created, ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY score DESC, created ASC) AS r
       FROM scores WHERE game = ?1)
     WHERE r = 1 ORDER BY score DESC, created ASC LIMIT ?2`).bind(game, limit).all();
  return results || [];
}

export async function handleScores(request, env, url) {
  const path = url.pathname.replace(/^\/hiscore/, '');
  if (path === '/GetScores' && request.method === 'GET') {
    const game = url.searchParams.get('gamename') || '';
    if (!GAMES.test(game)) return text(env, request, '<scores/>', 400, 'text/xml; charset=utf-8');
    const rows = await top(env, game);
    const body = '<?xml version="1.0" encoding="utf-8"?>\n<scores>\n' +
      rows.map((r) => `  <entry score="${Number(r.score) | 0}"><name>${xmlEscape(r.name)}</name></entry>\n`).join('') + '</scores>\n';
    return text(env, request, body, 200, 'text/xml; charset=utf-8');
  }
  if (path === '/top' && request.method === 'GET') {
    const game = url.searchParams.get('gamename') || '';
    if (!GAMES.test(game)) return json(env, request, { error: 'gamename' }, 400);
    return json(env, request, { game, scores: await top(env, game, 50) });
  }
  if (path === '/SaveScore' && request.method === 'POST') {
    let form;
    try {
      form = new URLSearchParams(await request.text());
    } catch (e) {
      return text(env, request, 'result=error&reason=form', 400);
    }
    const game = form.get('gamename') || '';
    const scoreText = form.get('score') || '';
    const hash = (form.get('hash') || '').toLowerCase();
    const name = cleanName(form.get('username'));
    const score = Number(scoreText);
    if (!GAMES.test(game) || !/^\d{1,9}$/.test(scoreText)) return text(env, request, 'result=error&reason=fields', 400);
    if (hash !== await sha1Hex(env.SCORE_SECRET + 'SaveScore' + game + scoreText)) return text(env, request, 'result=error&reason=hash', 403);
    if (!name || !decentName(name)) return text(env, request, 'result=error&reason=name', 400);
    if (score < 1 || score > MAX_SCORE) return text(env, request, 'result=error&reason=score', 400);
    const ipHash = (await sha256Hex(env.SCORE_SECRET + '|' + clientIp(request))).slice(0, 32);
    const now = Date.now();
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ?1 AND created > ?2').bind(ipHash, now - 3600000).first();
    if (recent && recent.n >= PER_HOUR) return text(env, request, 'result=error&reason=later', 429);
    await env.DB.prepare('INSERT INTO scores (game, name, score, created, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5)').bind(game, name, score, now, ipHash).run();
    return text(env, request, 'result=ok');
  }
  // the table's owner
  if (path === '/admin' || path.startsWith('/scores/')) {
    const auth = request.headers.get('Authorization') || '';
    if (!env.ADMIN_KEY || auth !== 'Bearer ' + env.ADMIN_KEY) return json(env, request, { error: 'unauthorised' }, 401);
    if (path === '/admin' && request.method === 'GET') {
      const game = url.searchParams.get('gamename') || 'CrystAlienConflict';
      const { results } = await env.DB.prepare('SELECT id, name, score, created FROM scores WHERE game = ?1 ORDER BY created DESC LIMIT 500').bind(game).all();
      return json(env, request, { game, rows: results || [] });
    }
    const id = Number(path.slice('/scores/'.length));
    if (request.method === 'DELETE' && Number.isInteger(id)) {
      const r = await env.DB.prepare('DELETE FROM scores WHERE id = ?1').bind(id).run();
      return json(env, request, { deleted: r.meta ? r.meta.changes : 0 });
    }
  }
  return json(env, request, { error: 'not found' }, 404);
}
