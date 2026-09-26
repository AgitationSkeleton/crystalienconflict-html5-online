"""
The game on a phone: an emulated touch screen, upright and on its side, through the menus to a
skirmish; screenshots of each, and (with --play) taps and drags as a player would make them.

    python tools/verify/mobile.py [--device "iPhone 13"] [--out work/mobile] [--play]
"""

import argparse
import functools
import http.server
import json
import math
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

# Where on the page things of this player's are, those in sight on the map (not behind the
# sidebar, nor off the edge): [x, y, id] each.
WHERE = '''(which) => { const lv = player.levels[1].panel.game.level; const me = lv.localPlayer;
  const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
  const all = lv.units.filter((x) => x.active && x.owner === me && !x.stats.miner && (which !== 'armed' || x.stats.weapon));
  return all.map((x) => [x.MC.$worldMatrix(), x.id]).filter(([w]) => w[4] > 165 && w[4] < r.stageW - 10 && w[5] > 30 && w[5] < r.stageH - 40)
    .map(([w, id]) => [b.left + (r.offsetX + w[4] * r.scale) / d, b.top + (r.offsetY + w[5] * r.scale) / d, id]); }'''


# Where a sidebar option of a kind (building or unit) shows, the quickest to make first: [x, y,
# title], or null.
OPTION = '''(kind) => { const lv = player.levels[1].panel.game.level, c = lv.construction;
  const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
  const opts = Object.values(c.options).filter((o) => o && o.MC && o.active && !o.disabled && (kind === 'building' ? o.isBuilding : o.isUnit));
  opts.sort((p, q) => p.constructionTime - q.constructionTime);
  for (const o of opts) { const w = o.MC.$worldMatrix(); const x = w[4] + w[0] * c.mugshotWidth / 2, y = w[5] + w[3] * c.mugshotHeight / 2;
    if (c.mask.hitTest(x, y, true)) return [b.left + (r.offsetX + x * r.scale) / d, b.top + (r.offsetY + y * r.scale) / d, o.title]; }
  return null; }'''

# Where this player's buildings are: [x, y] each.
BUILDINGS = '''() => { const lv = player.levels[1].panel.game.level; const me = lv.localPlayer;
  const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
  return lv.buildings.filter((x) => x.active && x.owner === me).map((x) => { const w = x.MC.$worldMatrix();
    return [b.left + (r.offsetX + w[4] * r.scale) / d, b.top + (r.offsetY + w[5] * r.scale) / d]; }); }'''


def play(page, out, orient):
    """A player's touches: tap a unit, tap the ground, the Deselect button, drag the view, a tap
    on the sidebar, pinch, press-hold-drag a box, double tap, tap-then-drag a box, place a
    building.  (Chrome's own touch input, by the DevTools protocol.)"""
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
    vw, vh = page.evaluate('() => [innerWidth, innerHeight]')

    def pos(uid):
        return page.evaluate('() => { const x = %s.find(%d); return [x.posX, x.posY]; }' % (LV, uid))

    def selected():
        return page.evaluate('() => %s.control.selected.map((x) => x.id)' % LV)

    def clear_ground(near):
        # somewhere on the map near a place, with nothing of anyone's within 70 pixels
        taken = page.evaluate('''() => { const lv = player.levels[1].panel.game.level;
          const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
          return lv.units.concat(lv.buildings).filter((x) => x.active).map((x) => { const w = x.MC.$worldMatrix();
            return [b.left + (r.offsetX + w[4] * r.scale) / d, b.top + (r.offsetY + w[5] * r.scale) / d]; }); }''')
        left = page.evaluate('() => { const r = player.renderer, b = r.canvas.getBoundingClientRect(); return b.left + (r.offsetX + 160 * r.scale) / (r.canvas.width / b.width); }')
        for rad in (80, 110, 140, 180):
            for k in range(12):
                x = near[0] + rad * math.cos(k * math.pi / 6)
                y = near[1] + rad * math.sin(k * math.pi / 6)
                if left < x < vw - 10 and 40 < y < vh - 60 and all(math.hypot(x - p[0], y - p[1]) > 70 for p in taken):
                    return (x, y)
        return None

    u = page.evaluate(WHERE, 'armed')[0]
    tap(u[0], u[1])
    time.sleep(0.4)
    results['a tap selects'] = page.evaluate('() => %s.control.selected.map((x) => x.id)' % LV) == [u[2]]
    before = page.evaluate('() => { const x = %s.find(%d); return [x.posX, x.posY]; }' % (LV, u[2]))
    tap(*clear_ground(u))
    time.sleep(2.5)
    after = page.evaluate('() => { const x = %s.find(%d); return [x.posX, x.posY]; }' % (LV, u[2]))
    results['a tap on the ground orders a move (selected after: %s)' % selected()] = before != after
    page.screenshot(path=os.path.join(out, orient + '-5-moved.png'))
    page.tap('.touchbar button[title=Deselect]')
    time.sleep(0.4)
    results['Deselect'] = page.evaluate('() => %s.control.selected.length' % LV) == 0
    cam0 = page.evaluate('() => [%s.camera.posX, %s.camera.posY]' % (LV, LV))
    map_left = page.evaluate('() => { const r = player.renderer, b = r.canvas.getBoundingClientRect(); return b.left + (r.offsetX + 158 * r.scale) / (r.canvas.width / b.width); }')
    drag((vw * 0.75, vh * 0.6), (vw * 0.55, vh * 0.4))
    time.sleep(0.3)
    cam1 = page.evaluate('() => [%s.camera.posX, %s.camera.posY]' % (LV, LV))
    results['a drag moves the view'] = cam1[0] > cam0[0] and cam1[1] > cam0[1]
    results['and selects nothing'] = page.evaluate('() => %s.control.selected.length' % LV) == 0
    # back where it was
    drag((vw * 0.55, vh * 0.4), (vw * 0.75, vh * 0.6))
    time.sleep(0.5)
    # a tap on the sidebar (a unit to make): taken, and nothing left lit after
    o = page.evaluate(OPTION, 'unit')
    if o:
        tap(o[0], o[1])
        time.sleep(0.8)
        st = page.evaluate('''() => { const c = %s.construction; return { made: !!(c.constructingUnit && c.constructingUnit.title === %s),
          lit: !!c.overOption, stats: !!%s.arena.radar.stats._visible }; }''' % (LV, json.dumps(o[2]), LV))
        results['a tap on the sidebar makes %s' % o[2]] = st['made']
        results['and leaves nothing lit %s' % st] = not st['lit'] and not st['stats']
    else:
        results['a unit on the sidebar to tap'] = False
    # zoom in with a pinch (the pointer left over the sidebar, where the wheel scrolls a list)
    page.evaluate('() => player.pointerMove(70, 220)')
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
    # and out again
    touch('touchStart', [(cx - 80, cy), (cx + 80, cy)])
    for i in range(1, 11):
        touch('touchMove', [(cx - 80 + 6 * i, cy), (cx + 80 - 6 * i, cy)])
        time.sleep(0.03)
    touch('touchEnd', [])
    time.sleep(0.8)
    z2 = page.evaluate('() => %s.arena.zoom' % LV)
    results['and out (%.2f)' % z2] = z2 < z1
    page.evaluate('() => { %s.arena.zoomBy(%s.arena.zoom > 1 ? 1 / %s.arena.zoom : 1, 400, 200); }' % (LV, LV, LV))
    time.sleep(0.3)
    # hold, then drag round the units: a selection box
    us = page.evaluate(WHERE, 'all')
    xs = [p[0] for p in us]
    ys = [p[1] for p in us]
    drag((max(map_left, min(xs) - 20), max(0, min(ys) - 20)), (max(xs) + 20, max(ys) + 20), steps=12, hold=0.6)
    time.sleep(0.5)
    n = page.evaluate('() => %s.control.selected.length' % LV)
    results['hold and drag selects a box (%d of %d)' % (n, len(us))] = n >= 2
    page.screenshot(path=os.path.join(out, orient + '-6-box.png'))

    # a double tap: deselects, and orders nothing
    u = page.evaluate(WHERE, 'armed')[0]
    tap(u[0], u[1])
    time.sleep(0.8)
    g = clear_ground(u)
    p0 = pos(u[2])
    tap(*g)
    time.sleep(0.12)
    tap(*g)
    time.sleep(1.5)
    results['a double tap deselects'] = selected() == []
    results['and orders nothing'] = pos(u[2]) == p0
    # a tap, then a touch dragged: a selection box, and the tap orders nothing
    tap(u[0], u[1])
    time.sleep(0.8)
    p0 = pos(u[2])
    us = page.evaluate(WHERE, 'all')
    xs = [p[0] for p in us]
    ys = [p[1] for p in us]
    a, b = (max(map_left, min(xs) - 20), max(0, min(ys) - 20)), (max(xs) + 20, max(ys) + 20)
    tap(*a)
    time.sleep(0.12)
    drag(a, b, steps=12)
    time.sleep(1.5)
    n = len(selected())
    results['tap, then drag, selects a box (%d of %d)' % (n, len(us))] = n >= 2
    results['and the tap orders nothing'] = pos(u[2]) == p0
    page.tap('.touchbar button[title=Deselect]')
    time.sleep(0.4)

    # placing a building: a touch puts it there, a drag moves it about, a tap on it builds it
    o = page.evaluate(OPTION, 'building')
    if not o:
        results['a building on the sidebar to make'] = False
    else:
        tap(o[0], o[1])
        done = False
        for _ in range(240):
            time.sleep(0.25)
            done = page.evaluate('() => { const b = %s.construction.constructingBuilding; return !!b && b.progress === b.constructionTime; }' % LV)
            if done:
                break
        results['%s made' % o[2]] = done
        n0 = len(page.evaluate(BUILDINGS))
        tap(o[0], o[1])
        time.sleep(0.5)
        results['a tap on it again: to place it'] = page.evaluate('() => !!%s.construction.buildingSite' % LV)
        # a drag round the headquarters, till it would go down
        hq = page.evaluate(BUILDINGS)[0]
        ring = [(hq[0] + r * math.cos(k * math.pi / 8), hq[1] + r * math.sin(k * math.pi / 8)) for r in (70, 100, 130, 160) for k in range(16)]
        ring = [p for p in ring if p[0] > vw * 0.3 and 40 < p[1] < vh - 60]
        touch('touchStart', [ring[0]])
        spot = None
        for p in ring:
            touch('touchMove', [p])
            time.sleep(0.15)
            if page.evaluate('() => { const s = %s.construction.buildingSite; return !!s && !!s.valid; }' % LV):
                spot = p
                break
        touch('touchEnd', [])
        time.sleep(0.4)
        results['a drag moves it (somewhere it can go: %s)' % (spot,)] = spot is not None and page.evaluate('() => !!%s.construction.buildingSite' % LV)
        page.screenshot(path=os.path.join(out, orient + '-7-site.png'))
        if spot:
            page.evaluate('''() => { const lv = player.levels[1].panel.game.level, c = lv.control; window.__trace = []; const orig = c.handle;
              c.handle = function () { const r = orig.apply(this, arguments); const s = lv.construction.buildingSite;
                __trace.push([player.frame, player.mouse.map(Math.round), !!this.MOUSEDOWN, this.mouseDownCount, s ? !!s.valid : null]); return r; }; }''')
            tap(*spot)
            time.sleep(1.5)
            site = page.evaluate('() => { const s = %s.construction.buildingSite; return s ? { valid: !!s.valid } : null; }' % LV)
            n1 = len(page.evaluate(BUILDINGS))
            results['a tap on it builds it (site after: %s, buildings %d to %d)' % (site, n0, n1)] = not site and n1 > n0
            if site:
                print(orient, 'trace', spot, page.evaluate('() => __trace.slice(0, 12)'), flush=True)
    errs = page.evaluate('() => [...player.errors.keys()]')
    results['no script errors %s' % errs] = not errs
    for k, v in results.items():
        print(orient, ('ok   ' if v else 'FAIL ') + k, flush=True)


if __name__ == '__main__':
    main()
