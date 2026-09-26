"""
Determinism: two browsers, one match.  Two pages play the same skirmish from the same seed,
each as a different one of its two human players (the other is "remote"), at different window
sizes; both step the game frame by frame, and every command either page issues is given to both
pages for the next frame -- lockstep, as online play does it over the network.  Every --every
frames the pages' states are hashed (every unit and building, every player's money, the
simulation's random draws) and compared; the first difference is reported with what differs.

    python tools/verify/twin.py [--map lego-mp13] [--frames 6000] [--every 50] [--bots 2]
                                [--mode all] [--settings JSON] [--script orders]

--script orders has both humans give a stream of orders (build, place, move, attack), chosen
from the same random numbers on both pages, as if played.
"""

import argparse
import functools
import http.server
import json
import os
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

HASH = r'''() => {
  const lv = player.levels[1].panel.game.level;
  let h = 2166136261 >>> 0;
  const mix = (v) => {
    const s = typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1000) : String(v)) : v;
    const t = String(s);
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 124; h = Math.imul(h, 16777619) >>> 0;
  };
  const parts = {};
  const note = (k, f) => { const before = h; f(); parts[k] = (parts[k] || 0) ^ h ^ before; };
  mix(lv.count); mix(player.simCalls);
  note('players', () => { for (const p of lv.players) { mix(p.index); mix(p.cash); mix(!!p.defeated); mix(p.powerCharge); } });
  note('units', () => { for (const u of lv.units) { if (!u || !u.active) continue; mix(u.id); mix(u.type); mix(u.posX); mix(u.posY); mix(u.health); mix(u.owner ? u.owner.index : -1); mix(u.target && u.target.id); mix(u.angle); } });
  note('buildings', () => { for (const b of lv.buildings) { if (!b || !b.active) continue; mix(b.id); mix(b.type); mix(b.health); mix(b.owner ? b.owner.index : -1); mix(b.tilePos.x); mix(b.tilePos.y); } });
  return { h, count: lv.count, simCalls: player.simCalls, units: lv.units.filter((u) => u && u.active).length, buildings: lv.buildings.filter((b) => b && b.active).length, parts };
}'''

# Every unit, in detail, for finding what differs.
DETAIL = r'''() => {
  const lv = player.levels[1].panel.game.level;
  const r = (v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  return {
    players: lv.players.map((p) => [p.index, r(p.cash), !!p.defeated]),
    units: lv.units.filter((u) => u && u.active).map((u) => [u.id, u.type, r(u.posX), r(u.posY), r(u.health), u.owner ? u.owner.index : -1, u.target && u.target.id, r(u.angle), u.mission && u.mission.kind]),
    buildings: lv.buildings.filter((b) => b && b.active).map((b) => [b.id, b.type, r(b.health), b.owner ? b.owner.index : -1]),
  };
}'''

# The pages' commands: issue() collects them instead of queueing, for the harness to deal.
CAPTURE = r'''() => {
  // A network that is the harness: what the page's player issues is collected, for the harness
  // to deal to both pages.
  window.__issued = [];
  player.online.net = { active: true, issue: (c) => window.__issued.push(JSON.parse(JSON.stringify(c))) };
}'''

# A human's orders, chosen by numbers both pages share (a seeded stream of the harness's own).
ORDERS = r'''([p, seed]) => {
  const lv = player.levels[1].panel.game.level;
  let a = seed >>> 0;
  const rnd = (n) => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n); };
  const me = lv.players[p];
  const out = [];
  const tech = lv.techFor(me);
  const types = Object.keys(tech).filter((k) => tech[k]).sort();
  const pr = me.production;
  const ready = pr && pr.ready && pr.ready();
  const mine = lv.units.filter((u) => u && u.active && u.owner === me && !u.stats.pickup).sort((x, y) => x.id - y.id);
  const theirs = [...lv.units, ...lv.buildings].filter((u) => u && u.active && u.owner && lv.hostile(u, me)).sort((x, y) => x.id - y.id);
  const k = rnd(10);
  if (ready) {
    const hq = lv.buildings.filter((b) => b.active && b.owner === me).sort((x, y) => x.id - y.id)[0];
    if (hq) { const s = lv.siteNear(ready, me, hq.tilePos, 6); if (s) out.push({ t: 'place', x: s.x, y: s.y, p }); }
  } else if (k < 3 && types.length) {
    out.push({ t: 'build', type: types[rnd(types.length)], p });
  } else if (k < 7 && mine.length) {
    const n = 1 + rnd(4), u = [];
    for (let i = 0; i < n; i++) u.push(mine[rnd(mine.length)].id);
    out.push({ t: 'move', u, x: 1 + rnd(lv.arena.cols), y: 1 + rnd(lv.arena.rows), p });
  } else if (theirs.length && mine.length) {
    out.push({ t: 'attack', u: mine.map((m) => m.id).slice(0, 6), o: theirs[rnd(theirs.length)].id, p });
  }
  return out;
}'''


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--map', default='cnc-scm96ea')
    ap.add_argument('--mode', default='all')
    ap.add_argument('--bots', type=int, default=2)
    ap.add_argument('--frames', type=int, default=6000)
    ap.add_argument('--every', type=int, default=50)
    ap.add_argument('--seed', type=int, default=4242)
    ap.add_argument('--settings', default=None)
    ap.add_argument('--script', default=None)
    ap.add_argument('--palette-b', default=None, help="the second page's palette (a player's preference; the view only)")
    ap.add_argument('--port', type=int, default=8796)
    args = ap.parse_args()

    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    colours = ['blue', 'red', 'green', 'purple', 'tan', 'cyan']

    def settings_for(me):
        players = []
        for i in range(2):
            players.append({'name': 'H%d' % i, 'faction': 'good' if i == 0 else 'evil', 'colour': colours[i], 'control': 'local' if i == me else 'remote'})
        for i in range(args.bots):
            players.append({'name': 'B%d' % i, 'faction': 'evil' if i % 2 == 0 else 'good', 'colour': colours[2 + i], 'control': 'bot', 'difficulty': 'hard'})
        s = {'map': args.map, 'mode': args.mode, 'cash': 20000, 'units': 3, 'prebuilt': True, 'shroud': True, 'superweapons': True,
             'palette': 'mars', 'specops': 'on', 'pizzaCost': 25000, 'crates': True, 'christmas': True, 'crateRate': 'often', 'players': players}
        if args.settings:
            s.update(json.loads(args.settings))
        if me == 1 and args.palette_b:
            s['palette'] = args.palette_b
        return s

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        pages = []
        for me, vp in ((0, (1200, 800)), (1, (1600, 900))):
            page = browser.new_page(viewport={'width': vp[0], 'height': vp[1]})
            page.on('pageerror', lambda e, me=me: print('[page %d error]' % me, e))
            page.goto('http://127.0.0.1:%d/index.html?test' % args.port)
            page.wait_for_function('() => window.player && player.levels[0]', timeout=60000)
            page.evaluate('() => { while (player.levels[0].$cur < 15) __step(1); }')
            xy = page.evaluate('''() => { const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
              const x = 300 + Math.round((r.stageW - 600) / 2), y = 373 + Math.round((r.stageH - 400) / 2);
              return [b.left + (r.offsetX + x * r.scale) / d, b.top + (r.offsetY + y * r.scale) / d]; }''')
            page.mouse.click(*xy)
            page.wait_for_function('() => player.levels[1] && !player.levels[1].$pending', timeout=180000)
            page.evaluate('() => { let n = 0; while (player.levels[1].$cur !== 201 && n++ < 1000) __step(1); }')
            page.wait_for_function('() => player.levels[1].panel', timeout=60000)
            page.evaluate('() => __step(70)')
            # (the menus' own frames drew on the other stream; the match starts the game's)
            page.evaluate(CAPTURE)
            page.evaluate('([seed, s]) => { player.seedRandom(seed); player.levels[1].panel.startSkirmish(s); }', [args.seed, settings_for(me)])
            pages.append(page)
        # both pages to the frame the level exists on
        for page in pages:
            n = page.evaluate('() => { let n = 0; while (!(player.levels[1].panel.game && player.levels[1].panel.game.level) && n < 200) { __step(1); n++; } return n; }')
            print('level made after %d frames' % n)
        pending = []
        first_bad = None
        last_good = None
        script_seed = 777
        for f in range(args.frames):
            if args.script == 'orders' and f % 23 == 0:
                for p in (0, 1):
                    script_seed += 1
                    pending += pages[0].evaluate(ORDERS, [p, script_seed])
            live = [page.evaluate('() => !!(player.levels[1].panel.game && player.levels[1].panel.game.level && player.levels[1].panel.game.level.active)') for page in pages]
            if not all(live):
                print('the match ended at frame %d: %s' % (f, 'on both pages' if not any(live) else 'ON ONE PAGE ONLY %s' % live))
                break
            for page in pages:
                page.evaluate('(cs) => { const lv = player.levels[1].panel.game.level; for (const c of cs) lv.commandQueue.push(c); __step(1); }', pending)
            issued = []
            for page in pages:
                issued += page.evaluate('() => { const x = window.__issued; window.__issued = []; return x; }')
            pending = sorted(issued, key=lambda c: (c.get('p', 0), json.dumps(c, sort_keys=True)))
            if (f + 1) % args.every == 0 or f == args.frames - 1:
                hs = [page.evaluate(HASH) for page in pages]
                if hs[0]['h'] != hs[1]['h']:
                    first_bad = (f + 1, hs)
                    break
                last_good = (f + 1, hs[0])
        if first_bad:
            f, hs = first_bad
            print('DIFFERENT at frame %d (last agreed at %s)' % (f, last_good[0] if last_good else '-'))
            for k in ('count', 'simCalls', 'units', 'buildings'):
                print('  %-10s %s  %s' % (k, hs[0][k], hs[1][k]))
            print('  parts differing:', [k for k in hs[0]['parts'] if hs[0]['parts'][k] != hs[1]['parts'].get(k)])
            ds = [page.evaluate(DETAIL) for page in pages]
            for key in ('players', 'units', 'buildings'):
                a = {json.dumps(x[:2]): x for x in ds[0][key]}
                b = {json.dumps(x[:2]): x for x in ds[1][key]}
                shown = 0
                for k in sorted(set(a) | set(b)):
                    if a.get(k) != b.get(k) and shown < 12:
                        print('  %s A %s' % (key, a.get(k)))
                        print('  %s B %s' % (key, b.get(k)))
                        shown += 1
        else:
            print('SAME for %d frames: %s' % (args.frames, json.dumps({k: last_good[1][k] for k in ('count', 'simCalls', 'units', 'buildings')})))
        for i, page in enumerate(pages):
            errs = page.evaluate('() => [...player.errors.keys()]')
            if errs:
                print('page %d script errors: %s' % (i, errs))
        browser.close()
    server.shutdown()


if __name__ == '__main__':
    main()
