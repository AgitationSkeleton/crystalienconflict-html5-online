"""
The game on a phone: an emulated touch screen, upright and on its side, through the menus to a
skirmish; screenshots of each, and (with --play) taps and drags as a player would make them.

    python tools/verify/mobile.py [--device "iPhone 13"] [--out work/mobile] [--play]
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


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--device', default='iPhone 13')
    ap.add_argument('--out', default=os.path.join(ROOT, 'work', 'mobile'))
    ap.add_argument('--port', type=int, default=8800)
    ap.add_argument('--play', action='store_true')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as pw:
        dev = pw.devices[args.device]
        browser = pw.chromium.launch()
        for orient in ('portrait', 'landscape'):
            opts = dict(dev)
            if orient == 'landscape':
                vp = opts['viewport']
                opts['viewport'] = {'width': vp['height'], 'height': vp['width']}
                if 'screen' in opts:
                    sc = opts['screen']
                    opts['screen'] = {'width': sc['height'], 'height': sc['width']}
            ctx = browser.new_context(**opts)
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto('http://127.0.0.1:%d/index.html' % args.port)
            page.wait_for_function('() => window.player && player.levels[0] && player.levels[0].$cur >= 15', timeout=60000)
            page.screenshot(path=os.path.join(args.out, orient + '-1-loader.png'))
            xy = page.evaluate('''() => { const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
              const x = 300 + Math.round((r.stageW - 600) / 2), y = 373 + Math.round((r.stageH - 400) / 2);
              return [b.left + (r.offsetX + x * r.scale) / d, b.top + (r.offsetY + y * r.scale) / d]; }''')
            page.touchscreen.tap(*xy)
            page.wait_for_function('() => window.onlineUI && onlineUI.attached', timeout=180000)
            time.sleep(0.5)
            page.screenshot(path=os.path.join(args.out, orient + '-2-menu.png'))
            page.evaluate("() => onlineUI.show('lobby')")
            time.sleep(0.3)
            page.screenshot(path=os.path.join(args.out, orient + '-3-lobby.png'), full_page=False)
            page.evaluate('() => onlineUI.start()')
            page.wait_for_function('() => { const g = player.levels[1].panel.game; return g && g.level && g.level.count > 30; }', timeout=60000)
            time.sleep(1)
            page.screenshot(path=os.path.join(args.out, orient + '-4-game.png'))
            info = page.evaluate('''() => ({ stage: [player.renderer.stageW, player.renderer.stageH], scale: player.renderer.scale,
              css: [innerWidth, innerHeight], dpr: devicePixelRatio, touch: navigator.maxTouchPoints })''')
            print(orient, json.dumps(info), 'errors', errs)
            if args.play:
                play(page, args.out, orient)
            ctx.close()
        browser.close()
    server.shutdown()


LV = 'player.levels[1].panel.game.level'

# Where on the page things of this player's are: [x, y, id] each.
WHERE = '''(which) => { const lv = player.levels[1].panel.game.level; const me = lv.localPlayer;
  const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
  const all = lv.units.filter((x) => x.active && x.owner === me && !x.stats.miner && (which !== 'armed' || x.stats.weapon));
  return all.map((x) => { const w = x.MC.$worldMatrix(); return [b.left + (r.offsetX + w[4] * r.scale) / d, b.top + (r.offsetY + w[5] * r.scale) / d, x.id]; }); }'''


def play(page, out, orient):
    """A player's touches: tap a unit, tap the ground, the Deselect button, drag the view,
    pinch, press-hold-drag a box.  (Chrome's own touch input, by the DevTools protocol.)"""
    cdp = page.context.new_cdp_session(page)

    def touch(kind, pts):
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})

    def tap(x, y):
        touch('touchStart', [(x, y)])
        time.sleep(0.02)
        touch('touchEnd', [])

    def drag(a, b, steps=10, hold=0.0):
        touch('touchStart', [a])
        time.sleep(hold)
        for i in range(1, steps + 1):
            touch('touchMove', [(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps)])
            time.sleep(0.03)
        touch('touchEnd', [])

    results = {}
    u = page.evaluate(WHERE, 'armed')[0]
    tap(u[0], u[1])
    time.sleep(0.4)
    results['a tap selects'] = page.evaluate('() => %s.control.selected.map((x) => x.id)' % LV) == [u[2]]
    before = page.evaluate('() => { const x = %s.find(%d); return [x.posX, x.posY]; }' % (LV, u[2]))
    tap(u[0] + 70, u[1] + 10)
    time.sleep(2.5)
    after = page.evaluate('() => { const x = %s.find(%d); return [x.posX, x.posY]; }' % (LV, u[2]))
    results['a tap on the ground orders a move'] = before != after
    page.screenshot(path=os.path.join(out, orient + '-5-moved.png'))
    page.tap('.touchbar button[title=Deselect]')
    time.sleep(0.4)
    results['Deselect'] = page.evaluate('() => %s.control.selected.length' % LV) == 0
    cam0 = page.evaluate('() => [%s.camera.posX, %s.camera.posY]' % (LV, LV))
    vw, vh = page.evaluate('() => [innerWidth, innerHeight]')
    drag((vw * 0.75, vh * 0.6), (vw * 0.55, vh * 0.4))
    time.sleep(0.3)
    cam1 = page.evaluate('() => [%s.camera.posX, %s.camera.posY]' % (LV, LV))
    results['a drag moves the view'] = cam1[0] > cam0[0] and cam1[1] > cam0[1]
    results['and selects nothing'] = page.evaluate('() => %s.control.selected.length' % LV) == 0
    # back where it was, and zoom in with a pinch
    drag((vw * 0.55, vh * 0.4), (vw * 0.75, vh * 0.6))
    time.sleep(0.5)
    z0 = page.evaluate('() => %s.arena.zoom' % LV)
    cx, cy = vw * 0.65, vh * 0.5
    touch('touchStart', [(cx - 20, cy), (cx + 20, cy)])
    for i in range(1, 11):
        touch('touchMove', [(cx - 20 - 6 * i, cy), (cx + 20 + 6 * i, cy)])
        time.sleep(0.03)
    touch('touchEnd', [])
    time.sleep(0.8)
    z1 = page.evaluate('() => %s.arena.zoom' % LV)
    results['a pinch zooms in (%.2f to %.2f)' % (z0, z1)] = z1 > z0
    # hold, then drag round the units: a selection box
    us = page.evaluate(WHERE, 'all')
    xs = [p[0] for p in us]
    ys = [p[1] for p in us]
    drag((max(0, min(xs) - 20), max(0, min(ys) - 20)), (max(xs) + 20, max(ys) + 20), steps=12, hold=0.6)
    time.sleep(0.5)
    n = page.evaluate('() => %s.control.selected.length' % LV)
    results['hold and drag selects a box (%d of %d)' % (n, len(us))] = n >= 2
    page.screenshot(path=os.path.join(out, orient + '-6-box.png'))
    errs = page.evaluate('() => [...player.errors.keys()]')
    results['no script errors %s' % errs] = not errs
    for k, v in results.items():
        print(orient, ('ok   ' if v else 'FAIL ') + k, flush=True)


if __name__ == '__main__':
    main()
