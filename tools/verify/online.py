"""
Online play, end to end: two browsers and a server (server/: npm run dev), on the game's real
clock.  One hosts through the menus, the other joins by the room's code, the host starts; both
players give orders for a while (the game's own issue(), so over the network); one browser
stalls for a few seconds and must not hold the other up, then catches up; the states' hashes
must agree turn for turn; then one quits (surrendering), and the other wins and is back in the
room.

    python tools/verify/online.py [--server http://127.0.0.1:8787] [--seconds 60] [--map cnc-scm96ea]
"""

import argparse
import functools
import http.server
import json
import os
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

ORDERS = r'''() => {
  // Every second and a half, an order of this page's player's: build, place, move or attack.
  window.__orders = setInterval(() => {
    const game = player.levels[1].panel.game;
    const lv = game && game.level;
    if (!lv || !lv.active || !lv.localPlayer || lv.localPlayer.defeated) return;
    const me = lv.localPlayer;
    const r = (n) => Math.floor(Math.random() * n);
    const tech = lv.techFor(me);
    const types = Object.keys(tech).filter((k) => tech[k]);
    const ready = me.production && me.production.ready && me.production.ready();
    const mine = lv.units.filter((u) => u && u.active && u.owner === me && !u.stats.pickup);
    const theirs = [...lv.units, ...lv.buildings].filter((u) => u && u.active && u.owner && lv.hostile(u, me));
    if (ready) {
      const hq = lv.buildings.find((b) => b.active && b.owner === me);
      const s = hq && lv.siteNear(ready, me, hq.tilePos, 6);
      if (s) lv.issue({ t: 'place', x: s.x, y: s.y });
    } else if (Math.random() < 0.35 && types.length) {
      lv.issue({ t: 'build', type: types[r(types.length)] });
    } else if (Math.random() < 0.6 && mine.length) {
      lv.issue({ t: 'move', u: [mine[r(mine.length)].id], x: (1 + r(lv.arena.cols)) * 96, y: (1 + r(lv.arena.rows)) * 48 });
    } else if (theirs.length && mine.length) {
      lv.issue({ t: 'attack', u: mine.slice(0, 5).map((m) => m.id), o: theirs[r(theirs.length)].id });
    }
  }, 1500);
}'''

STATE = r'''() => {
  const net = onlineUI.net;
  const game = player.levels[1].panel.game;
  const lv = game && game.level;
  return { active: net.active, count: lv ? lv.count : null, behind: net.behind(), hashes: net.match ? [...net.match.hashes.entries()] : [],
    toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent), errors: [...player.errors.keys()],
    screen: [...document.querySelectorAll('.screen.active')].map((s) => s.className), room: net.room && net.room.phase };
}'''


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def boot(page, port, server):
    page.goto('http://127.0.0.1:%d/index.html?server=%s' % (port, server))
    page.wait_for_function('() => window.player && player.levels[0] && player.levels[0].$cur >= 15', timeout=60000)
    xy = page.evaluate('''() => { const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
      const x = 300 + Math.round((r.stageW - 600) / 2), y = 373 + Math.round((r.stageH - 400) / 2);
      return [b.left + (r.offsetX + x * r.scale) / d, b.top + (r.offsetY + y * r.scale) / d]; }''')
    page.mouse.click(*xy)
    page.wait_for_function('() => window.onlineUI && onlineUI.attached', timeout=180000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--server', default='http://127.0.0.1:8787')
    ap.add_argument('--seconds', type=float, default=60)
    ap.add_argument('--map', default='cnc-scm96ea')
    ap.add_argument('--port', type=int, default=8799)
    args = ap.parse_args()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    failures = []

    def check(cond, what):
        print(('ok   ' if cond else 'FAIL ') + what, flush=True)
        if not cond:
            failures.append(what)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        a = browser.new_context(viewport={'width': 1280, 'height': 800}).new_page()
        b = browser.new_context(viewport={'width': 1024, 'height': 700}).new_page()
        for i, page in enumerate((a, b)):
            page.on('pageerror', lambda e, i=i: print('[page %s error] %s' % ('AB'[i], e), flush=True))
            page.on('console', lambda m, i=i: print('[page %s] %s' % ('AB'[i], m.text), flush=True) if m.type == 'error' else None)
        boot(a, args.port, args.server)
        boot(b, args.port, args.server)
        a.evaluate("() => { onlineUI.settings.name = 'Ann'; }")
        b.evaluate("() => { onlineUI.settings.name = 'Bob'; }")
        a.evaluate('() => onlineUI.host()')
        a.wait_for_function('() => onlineUI.net.room && onlineUI.net.isHost', timeout=20000)
        code = a.evaluate('() => onlineUI.net.code')
        check(bool(code), 'Ann hosts: room ' + str(code))
        a.evaluate("(map) => onlineUI.setRoomMatch({ map, mode: 'all', cash: 20000, crates: true, units: 3, prebuilt: true })", args.map)
        b.evaluate('(code) => onlineUI.joinRoom(code)', code)
        a.wait_for_function('() => onlineUI.net.room.slots.slice(0, onlineUI.net.room.count).filter((s) => s.kind === "member").length === 2', timeout=20000)
        check(True, 'Bob joins by the code and has a slot')
        b.evaluate("() => onlineUI.net.setSlot(onlineUI.net.room.slots.findIndex((s) => s.member === onlineUI.net.you), { colour: 'red', faction: 'evil' })")
        time.sleep(1)
        a.screenshot(path=os.path.join(ROOT, 'work', 'online-room.png'))
        a.evaluate('() => onlineUI.startOnline()')
        for page in (a, b):
            page.wait_for_function('() => { const g = player.levels[1].panel.game; return onlineUI.net.active && g && g.level && g.level.count > 5; }', timeout=30000)
        check(True, 'the match starts on both')
        for page in (a, b):
            page.evaluate(ORDERS)
        t0 = time.time()
        stalled = False
        while time.time() - t0 < args.seconds:
            time.sleep(2)
            if not stalled and time.time() - t0 > args.seconds / 3:
                # Bob's browser freezes for four seconds: Ann's game must go on.
                before = a.evaluate(STATE)['count']
                b.evaluate('() => { const t = performance.now(); while (performance.now() - t < 4000) {} }')
                after = a.evaluate(STATE)['count']
                check(after - before > 40, "Ann's game goes on while Bob's browser is frozen (%s frames)" % (after - before))
                stalled = True
        # Ann's pause menu: over the network the game goes on.
        before = a.evaluate(STATE)['count']
        a.keyboard.down('Escape')
        time.sleep(0.3)
        a.keyboard.up('Escape')
        time.sleep(2)
        after = a.evaluate(STATE)['count']
        check(after - before > 30, 'Ann opens her menu; the game goes on (%s frames)' % (after - before))
        a.evaluate('() => player.levels[1].panel.game.hud.pressResume()')
        # Cat joins the match under way: she watches, from the start, caught up.
        c = browser.new_context(viewport={'width': 1000, 'height': 700}).new_page()
        c.on('pageerror', lambda e: print('[page C error] %s' % e, flush=True))
        boot(c, args.port, args.server)
        c.evaluate("(code) => { onlineUI.settings.name = 'Cat'; onlineUI.joinRoom(code); }", code)
        c.wait_for_function('() => onlineUI.net.active', timeout=30000)
        try:
            c.wait_for_function('() => { const g = player.levels[1].panel.game; return g && g.level && onlineUI.net.behind() < 10 && g.level.count > 900; }', timeout=120000)
            sc = c.evaluate(STATE)
            check(True, 'Cat, joining late, watches, caught up at frame %s' % sc['count'])
            check(c.evaluate('() => player.levels[1].panel.game.level.localPlayer.spectator === true'), 'and watches (a spectator)')
        except Exception as e:
            check(False, 'Cat catches up: %s' % c.evaluate(STATE))
        time.sleep(3)
        sa, sb, sc = a.evaluate(STATE), b.evaluate(STATE), c.evaluate(STATE)
        hc = dict(sc['hashes'])
        ha0 = dict(sa['hashes'])
        commonc = sorted(set(ha0) & set(hc))
        check(len(commonc) >= 1 and all(ha0[t] == hc[t] for t in commonc), "Cat's game agrees with Ann's: %d hashes" % len(commonc))
        check(sa['count'] > 1000 and sb['count'] > 1000, 'both have played: %s and %s frames' % (sa['count'], sb['count']))
        check(abs(sa['count'] - sb['count']) < 200, 'Bob has caught up: %s against %s' % (sb['count'], sa['count']))
        ha, hb = dict(sa['hashes']), dict(sb['hashes'])
        common = sorted(set(ha) & set(hb))
        same = [t for t in common if ha[t] == hb[t]]
        check(len(common) >= 5 and len(same) == len(common), 'the games agree: %d of %d hashes the same' % (len(same), len(common)))
        check(not sa['toasts'] and not sb['toasts'], 'no desync: %s %s' % (sa['toasts'], sb['toasts']))
        check(not sa['errors'] and not sb['errors'], 'no script errors: %s %s' % (sa['errors'], sb['errors']))
        a.screenshot(path=os.path.join(ROOT, 'work', 'online-match-a.png'))
        b.screenshot(path=os.path.join(ROOT, 'work', 'online-match-b.png'))
        # Bob quits (surrenders): Ann is the last team standing, and back in the room.
        for page in (a, b):
            page.evaluate('() => clearInterval(window.__orders)')
        b.evaluate('() => onlineUI.net.quit()')
        try:
            a.wait_for_function('() => !onlineUI.net.active && onlineUI.net.room && onlineUI.net.room.phase === "lobby" && document.querySelector(".screen.room.active")', timeout=40000)
            check(True, "Bob quits; Ann wins and is back in the room")
        except Exception as e:
            check(False, 'Ann back in the room after Bob quits: %s' % a.evaluate(STATE))
        check(b.evaluate('() => !!document.querySelector(".screen.online.active")'), 'Bob is back at the list of games')
        browser.close()
    server.shutdown()
    print('all passed' if not failures else '%d failed' % len(failures))


if __name__ == '__main__':
    main()
