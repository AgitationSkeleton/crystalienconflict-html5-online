// The room's protocol against a running server (npm run dev, then npm test; SERVER=... for
// another): two people make and fill a room, the host starts a match, both send their turns,
// one falls behind and is not waited for, one surrenders; the master server lists the room;
// scores are saved and read.
const SERVER = process.env.SERVER || 'http://127.0.0.1:8787';
const WS = SERVER.replace(/^http/, 'ws');
let failures = 0;
const ok = (cond, what) => {
  if (!cond) failures++;
  console.log((cond ? 'ok   ' : 'FAIL ') + what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function person(code, name, extra = {}) {
  const ws = new WebSocket(`${WS}/rooms/${code}/ws`);
  const p = { ws, name, got: [], room: null, you: null, bundles: [], start: null };
  p.opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(Object.assign({ type: 'hello', name, token: 'token-' + name + '-' + Math.random().toString(36).slice(2) }, extra)));
      resolve();
    });
    ws.addEventListener('error', reject);
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    p.got.push(m);
    if (m.type === 'welcome') { p.you = m.you; p.room = m.room; }
    if (m.type === 'room') p.room = m.room;
    if (m.type === 'start') p.start = m;
    if (m.type === 't') p.bundles.push(m);
    if (m.type === 'log') p.bundles.push(...m.bundles);
  });
  p.send = (m) => ws.send(JSON.stringify(m));
  p.until = async (fn, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(20);
    }
    return false;
  };
  return p;
}

// ---- rooms --------------------------------------------------------------------------------------
const made = await (await fetch(`${SERVER}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access: 'public', name: "Ann's game" }) })).json();
ok(/^[A-Z0-9]{6}$/.test(made.code), 'a room is made: ' + made.code);
const ann = person(made.code, 'Ann');
await ann.opened;
ok(await ann.until(() => ann.room && ann.room.host === ann.you), 'the first in is the host');
ok(ann.room.slots[0].kind === 'member' && ann.room.slots[0].member === ann.you, 'and has the first slot');
const bob = person(made.code, 'Bob');
await bob.opened;
ok(await bob.until(() => bob.room && bob.room.slots[1].member === bob.you), 'the second has the second slot');
ann.send({ type: 'slots', count: 3 });
ann.send({ type: 'slot', slot: 2, kind: 'bot' });
ann.send({ type: 'match', match: { map: 'cnc-scm96ea', mode: 'ctf' } });
ok(await bob.until(() => bob.room.count === 3 && bob.room.slots[2].kind === 'bot' && bob.room.match && bob.room.match.mode === 'ctf'), 'the host sets slots, a bot and the match; everyone sees');
bob.send({ type: 'match', match: { mode: 'all' } });
await sleep(200);
ok(ann.room.match.mode === 'ctf', 'only the host changes the match');
bob.send({ type: 'slot', slot: 1, colour: 'purple', faction: 'evil' });
ok(await ann.until(() => ann.room.slots[1].colour === 'purple'), 'a person sets their own colour');
ann.send({ type: 'chat', text: 'hello there' });
ok(await bob.until(() => bob.got.some((m) => m.type === 'chat' && m.text === 'hello there')), 'chat');
await sleep(1200);
const listed = await (await fetch(`${SERVER}/lobbies`)).json();
const entry = listed.rooms.find((r) => r.code === made.code);
ok(entry && entry.host === 'Ann' && entry.mode === 'ctf' && entry.players === 3, 'the master server lists it: ' + JSON.stringify(entry));
const info = await (await fetch(`${SERVER}/rooms/${made.code}`)).json();
ok(info.exists && info.phase === 'lobby', 'a room answers for itself (a ping)');

// ---- a password room ------------------------------------------------------------------------
const locked = await (await fetch(`${SERVER}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access: 'password', password: 'sesame', name: 'Locked' }) })).json();
const kim = person(locked.code, 'Kim', { password: 'sesame' });
await kim.opened;
ok(await kim.until(() => kim.you), 'the host of a password room gets in with it');
const eve = person(locked.code, 'Eve', { password: 'wrong' });
await eve.opened;
ok(await eve.until(() => eve.got.some((m) => m.type === 'error' && m.reason === 'password')), 'a wrong password is turned away');

// ---- the match --------------------------------------------------------------------------------
const settings = { map: 'cnc-scm96ea', mode: 'ctf', speed: 1, players: [
  { name: 'Ann', control: 'remote', member: ann.you, faction: 'good', colour: 'blue' },
  { name: 'Bob', control: 'remote', member: bob.you, faction: 'evil', colour: 'purple' },
  { name: 'Computer', control: 'bot', faction: 'good', colour: 'tan', difficulty: 'medium' }] };
bob.send({ type: 'start', settings });
await sleep(200);
ok(!ann.start, 'only the host starts');
ann.send({ type: 'start', settings });
ok(await bob.until(() => bob.start && bob.start.seats[bob.you] === 1 && bob.start.seats[ann.you] === 0), 'the match starts, with seats');
const delay = bob.start.delay;
ok(delay >= 2 && await bob.until(() => bob.bundles.length >= delay), 'the first ' + delay + ' turns come empty');
// Both send turns: Ann orders something on her turn delay.
for (let n = delay; n < delay + 20; n++) {
  ann.send({ type: 'in', n, c: n === delay + 3 ? [{ t: 'move', u: [5], x: 100, y: 200 }] : [] });
  bob.send({ type: 'in', n, c: [] });
}
ok(await bob.until(() => bob.bundles.length >= delay + 20), 'turns come when everyone has sent theirs');
const b3 = bob.bundles.find((b) => b.n === delay + 3);
ok(b3 && b3.c.length === 1 && b3.c[0][0] === 0 && b3.c[0][1].t === 'move', "Ann's order is in its turn, as hers");
ok(bob.bundles.every((b, i) => b.n === i), 'in order, none missing');
// Bob falls behind: after a moment the turn goes without him.
const t0 = Date.now();
ann.send({ type: 'in', n: delay + 20, c: [] });
ok(await ann.until(() => ann.bundles.some((b) => b.n === delay + 20), 2000) && Date.now() - t0 >= 200, 'a turn waits a moment for someone behind, then goes');
for (let n = delay + 21; n < delay + 25; n++) ann.send({ type: 'in', n, c: [] });
ok(await ann.until(() => ann.bundles.some((b) => b.n === delay + 24), 1000), 'and then does not wait for him');
bob.send({ type: 'in', n: delay + 20, c: [{ t: 'build', type: 'UA_evil' }] });
ann.send({ type: 'in', n: delay + 25, c: [] });
ok(await ann.until(() => ann.bundles.some((b) => b.n === delay + 25 && b.c.some(([p, c]) => p === 1 && c.t === 'build'))), 'what he sent late goes in the next turn');
// A hash that differs is told.
ann.send({ type: 'hash', n: 10, h: 'aaa' });
bob.send({ type: 'hash', n: 10, h: 'bbb' });
ok(await ann.until(() => ann.got.some((m) => m.type === 'desync')), 'browsers that disagree are told');
// Someone joining now watches, from the start.
const cat = person(made.code, 'Cat');
await cat.opened;
ok(await cat.until(() => cat.start && cat.bundles.length >= delay + 25), 'someone who joins a match under way gets it from the start: ' + cat.bundles.length + ' turns');
ok(cat.start && cat.start.seats[cat.you] === undefined, 'and watches');
// Bob surrenders: the next turn says he left.
bob.send({ type: 'surrender' });
for (let n = delay + 26; n < delay + 30; n++) ann.send({ type: 'in', n, c: [] });
ok(await ann.until(() => ann.bundles.some((b) => b.left && b.left.includes(1))), 'a surrender is in a turn');
// The match ends: back to the lobby, the watcher with a slot.
ann.send({ type: 'ended' });
ok(await cat.until(() => cat.room && cat.room.phase === 'lobby'), 'back to the lobby when it ends');
ok(!cat.room.slots.some((s) => s.member === cat.you), 'the watcher has no slot while none is free');
ann.send({ type: 'slots', count: 4 });
ok(await cat.until(() => cat.room.count === 4), 'more slots');
cat.send({ type: 'take', slot: 3 });
ok(await cat.until(() => cat.room.slots[3].member === cat.you), 'the watcher takes one');
// Kicking.
ann.send({ type: 'kick', member: cat.you });
ok(await cat.until(() => cat.got.some((m) => m.type === 'kicked')), 'the host kicks');

// ---- scores ------------------------------------------------------------------------------------
const table = await (await fetch(`${SERVER}/hiscore/GetScores?gamename=CrystAlienConflict`)).text();
ok(table.includes('<scores>'), 'the score table answers');

for (const p of [ann, bob, cat, kim, eve]) {
  try {
    p.ws.close();
  } catch (e) {
    // (closed)
  }
}
console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
