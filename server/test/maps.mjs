// Custom maps against a running server (npm run dev, then node test/maps.mjs; SERVER=... for
// another): sharing a map, it waiting for review, approved (the admin endpoint here, Discord's
// reactions in use), listed, liked, played, scored; what is refused; the day's limit; a ban.
// ADMIN_KEY from .dev.vars.  (Locally the bans and the day's uploads are cleared before and
// after: every test comes from the one address.)

import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import * as C from '../../src/online/cacmap.js';

const SERVER = process.env.SERVER || 'http://127.0.0.1:8787';
const SECRET = '6a8566530d02deedf2beecbd1868d45f068613ca';
const ADMIN = (readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_KEY=(.*)$/m) || [])[1].trim().replace(/^["']|["']$/g, '');
let failures = 0;
const ok = (cond, what) => {
  if (!cond) failures++;
  console.log((cond ? 'ok   ' : 'FAIL ') + what);
};
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const key = () => randomBytes(16).toString('hex');
const headers = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:8875' };
const call = async (method, path, body, extra = {}) => {
  const r = await fetch(SERVER + path, { method, headers: Object.assign({}, headers, extra), body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const type = r.headers.get('Content-Type') || '';
  return { status: r.status, body: type.includes('json') ? await r.json() : await r.arrayBuffer() };
};
const share = (k, map, more = {}) => {
  const text = JSON.stringify(map);
  return call('POST', '/maps', Object.assign({ key: k, author: 'Tester', map: text, sig: sha1(SECRET + 'SaveMap' + text) }, more));
};
const admin = (path, body) => call(body ? 'POST' : 'GET', '/maps/admin/' + path, body, { Authorization: 'Bearer ' + ADMIN });

const clear = () => { if (/127.0.0.1|localhost/.test(SERVER)) execSync('npx wrangler d1 execute crystalien --local --command "DELETE FROM map_bans; DELETE FROM map_uploads; DELETE FROM map_config"', { stdio: 'ignore', cwd: new URL('..', import.meta.url) }); };
clear();
const sky = C.blank('skirmish', 24, 24);
sky.name = 'Test Island ' + Date.now().toString(36);
sky.desc = 'Two bases and a lake.';
sky.bases = [{ x: 4, y: 4 }, { x: 20, y: 20 }];
const me = key(), you = key();

// what is refused
ok((await share(me, sky, { sig: 'x' })).status === 403, 'a map without the game\'s hash');
ok((await call('POST', '/maps', { key: me, author: 'T', map: '{"v":2}', sig: sha1(SECRET + 'SaveMap{"v":2}') })).status === 400, 'not a map');
ok((await share('nope', sky)).status === 400, 'no author key');
ok((await share(me, Object.assign({}, sky, { name: 'www.example.com' }))).status === 400, 'a link for a name');
ok((await share(me, Object.assign({}, sky, { name: "x'); DROP TABLE maps;--" }))).status !== 500, 'a name with SQL in it is only a name');
ok((await call('POST', '/maps', 'x'.repeat(200000))).status === 400, 'too big');

// shared, waiting, approved
const up = await share(me, sky);
ok(up.status === 200 && up.body.status === 'pending' && /^[a-z0-9]{10}$/.test(up.body.id), 'shared: waiting for review');
const id = up.body.id;
let listed = await call('GET', '/maps?q=' + encodeURIComponent(sky.name.toLowerCase()));
ok(!listed.body.maps.some((m) => m.id === id), 'not listed while it waits');
ok((await call('GET', '/maps/' + id)).status === 404, 'not to be had by others while it waits');
ok((await call('GET', '/maps/' + id + '?key=' + me)).status === 200, 'its author has it');
ok((await call('GET', '/maps/mine?key=' + me)).body.maps.some((m) => m.id === id && m.status === 'pending'), 'in its author\'s list');
ok((await admin('pending')).body.maps.some((m) => m.id === id), 'in the review list');
ok((await call('GET', '/maps/admin/pending')).status === 401, 'the review list needs the key');
ok((await admin(id, { action: 'approve' })).body.status === 'approved', 'approved');
listed = await call('GET', '/maps?kind=skirmish&q=' + encodeURIComponent(sky.name.toLowerCase()));
ok(listed.body.maps.some((m) => m.id === id && m.players === 2 && m.author === 'Tester'), 'listed');
const got = await call('GET', '/maps/' + id + '?key=' + you);
ok(got.status === 200 && C.validate(got.body.map).ok && got.body.map.name === sky.name, 'downloaded, and a valid map');
const png = await call('GET', '/maps/' + id + '/preview.png');
ok(png.status === 200 && new Uint8Array(png.body)[1] === 0x50, 'its picture (' + png.body.byteLength + ' bytes)');

// a map's picture, as the game drew it: kept and shown if it is a picture, refused if not
const jpeg = readFileSync(new URL('./picture.jpg', import.meta.url)).toString('base64');
const withPic = await share(me, Object.assign({}, sky, { name: 'Pictured ' + Date.now().toString(36) }), { thumb: jpeg });
ok(withPic.status === 200, 'shared with its picture');
const shown = await fetch(SERVER + '/maps/' + withPic.body.id + '/preview.png');
ok(shown.headers.get('Content-Type') === 'image/jpeg' && shown.headers.get('X-Content-Type-Options') === 'nosniff' && Buffer.from(await shown.arrayBuffer()).toString('base64') === jpeg, 'its picture is the one sent, as a JPEG');
ok((await share(me, sky, { thumb: Buffer.from('<script>alert(1)</script>').toString('base64') })).status === 400, 'a picture that is not one is refused');
ok((await share(me, sky, { thumb: 'not base64!' })).status === 400, 'nor anything else');
ok((await call('GET', '/maps?q=' + encodeURIComponent(sky.name.toLowerCase()))).body.maps.every((m) => m.map && m.map.w === sky.w), 'the list carries the maps\' data, to draw them by');

// liked, played
ok((await call('POST', '/maps/' + id + '/like', { key: you, like: true })).body.likes === 1, 'liked');
ok((await call('POST', '/maps/' + id + '/like', { key: you, like: true })).body.likes === 1, 'liked once a player');
ok((await call('GET', '/maps/' + id + '?key=' + you)).body.liked === true, 'they see they like it');
ok((await call('POST', '/maps/' + id + '/like', { key: you, like: false })).body.likes === 0, 'not liked any more');
await call('POST', '/maps/' + id + '/play', { key: you });
await call('POST', '/maps/' + id + '/play', { key: you });
ok((await call('GET', '/maps/' + id)).body.plays === 1, 'played, counted once a player');

// a singleplayer map's scores
const st = C.blank('story', 20, 20);
st.name = 'Test Mission ' + Date.now().toString(36);
st.story.units.push({ t: 'BA_good', x: 5, y: 5, own: 'player' }, { t: 'BD_evil', x: 15, y: 15, own: 'enemy', b: 'seek' });
const sid = (await share(me, st)).body.id;
await admin(sid, { action: 'approve' });
const score = (k, seconds, cash, version = 1) => call('POST', '/maps/' + sid + '/score', { key: k, name: 'Ace', seconds, cash, version, sig: sha1(SECRET + 'SaveMapScore' + sid + seconds + '|' + cash) });
ok((await score(me, 300, 1000)).status === 200, 'a score');
await score(me, 400, 9000);
await score(you, 300, 2000);
ok((await call('POST', '/maps/' + sid + '/score', { key: me, name: 'Ace', seconds: 10, cash: 0, version: 1, sig: 'x' })).status === 403, 'a score without the game\'s hash');
ok((await score(me, 200, 0, 7)).status === 409, 'a score for another version');
let sc = (await call('GET', '/maps/' + sid + '/scores')).body.scores;
ok(sc.length === 2 && sc[0].cash === 2000 && sc[1].seconds === 300 && sc[1].cash === 1000, 'the best of each, quickest then richest');
ok((await call('POST', '/maps/' + id + '/score', { key: me, name: 'A', seconds: 50, cash: 1, version: 1, sig: sha1(SECRET + 'SaveMapScore' + id + '50|1') })).status === 400, 'no scores for a skirmish map');

// a new version: waiting again, its scores over
const st2 = Object.assign({}, st, { desc: 'Harder now.' });
const v2 = await share(me, st2, { id: sid });
ok(v2.body.version === 2 && v2.body.status === 'pending', 'a new version waits for review');
ok((await share(you, st2, { id: sid })).status === 403, 'nobody else can change it');
await admin(sid, { action: 'approve' });
sc = (await call('GET', '/maps/' + sid + '/scores')).body.scores;
ok(sc.length === 0, 'the new version\'s scores start again');

// taken down by its author; a ban
ok((await call('DELETE', '/maps/' + sid + '?key=' + you)).status === 403, 'only its author takes it down');
ok((await call('DELETE', '/maps/' + sid + '?key=' + me)).status === 200 && (await call('GET', '/maps/' + sid)).status === 404, 'taken down');
// (five a day, each)
let n = 0;
const flood = key();
for (let i = 0; i < 6; i++) if ((await share(flood, Object.assign({}, sky, { name: 'Flood ' + i }))).status === 200) n++;
ok(n === 5, 'five maps a day (' + n + ')');
const bad = key();
const b1 = (await share(bad, Object.assign({}, sky, { name: 'Spam ' + Date.now().toString(36) }))).body.id;
await admin(b1, { action: 'ban' });
ok((await share(bad, sky)).status === 403, 'a banned author cannot share');
clear();
console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
