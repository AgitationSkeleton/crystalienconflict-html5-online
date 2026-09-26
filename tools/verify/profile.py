"""
Where the time goes: play a skirmish in headless Chromium and report how long the game's
ticks and the drawing take, and which functions the time is spent in (a CPU profile).

    python tools/verify/profile.py [--map lego-mp26] [--palette snowy] [--mode pizza]
                                   [--bots 3] [--frames 1500] [--warm 600] [--viewport 1600x900]

The game runs in test mode (a stopped clock); after --warm frames to let the bases grow, the
next --frames frames are timed one by one: a tick (the game's logic, bots and all) and a
draw.  The CPU profile covers those frames too.
"""

import argparse
import collections
import functools
import http.server
import json
import os
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--map', default='lego-mp26')
    ap.add_argument('--palette', default='snowy')
    ap.add_argument('--mode', default='pizza')
    ap.add_argument('--bots', type=int, default=3)
    ap.add_argument('--frames', type=int, default=1500)
    ap.add_argument('--warm', type=int, default=600)
    ap.add_argument('--viewport', default='1600x900')
    ap.add_argument('--port', type=int, default=8791)
    ap.add_argument('--top', type=int, default=40)
    ap.add_argument('--nodraw', action='store_true', help='tick only')
    ap.add_argument('--drawonly', action='store_true', help='profile the drawing: tick outside the profile, draw inside')
    ap.add_argument('--probe', action='store_true', help='time the filtered drawing and team colouring (probe_draw.js)')
    ap.add_argument('--probe2', action='store_true', help='time the slow frames by clip (probe_children.js)')
    ap.add_argument('--probe3', action='store_true', help='time the slow frames by canvas call (probe_canvas.js)')
    ap.add_argument('--trace', default=None, help='write a Chromium performance trace of the timed frames to this file')
    ap.add_argument('--noprofile', action='store_true', help='no CPU profile (timing and memory only)')
    ap.add_argument('--gpu', action='store_true', help='Chromium with the GPU (as a browser here would), not the software renderer')
    args = ap.parse_args()
    vw, vh = (int(v) for v in args.viewport.split('x'))

    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    colours = ['blue', 'red', 'green', 'purple', 'tan', 'cyan']
    players = [{'name': 'Me', 'faction': 'good', 'colour': colours[0], 'control': 'local'}]
    for i in range(args.bots):
        players.append({'name': 'B%d' % i, 'faction': 'evil' if i % 2 == 0 else 'good', 'colour': colours[i + 1],
                        'control': 'bot', 'difficulty': 'hard'})
    settings = {'map': args.map, 'mode': args.mode, 'cash': 30000, 'units': 3, 'prebuilt': True, 'shroud': True,
                'superweapons': True, 'palette': args.palette, 'specops': 'on', 'pizzaCost': 50000, 'players': players}

    with sync_playwright() as pw:
        if args.gpu:
            browser = pw.chromium.launch(channel='chromium', args=['--enable-precise-memory-info', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'])
        else:
            browser = pw.chromium.launch(args=['--enable-precise-memory-info'])
        page = browser.new_page(viewport={'width': vw, 'height': vh})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: print('[page]', m.text, flush=True) if m.text.startswith('@') else None)
        page.goto('http://127.0.0.1:%d/index.html?test&seed=1' % args.port)
        page.wait_for_function('() => window.player && player.levels[0]', timeout=60000)
        page.evaluate('() => { while (player.levels[0].$cur < 15) __step(1); }')
        # the loader's button, wherever the stage puts it
        xy = page.evaluate('''() => { const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
          const x = 300 + Math.round((r.stageW - 600) / 2), y = 373 + Math.round((r.stageH - 400) / 2);
          return [b.left + (r.offsetX + x * r.scale) / d, b.top + (r.offsetY + y * r.scale) / d]; }''')
        page.mouse.click(*xy)
        page.wait_for_function('() => player.levels[1] && !player.levels[1].$pending', timeout=180000)
        page.evaluate('() => { let n = 0; while (player.levels[1].$cur !== 201 && n++ < 1000) __step(1); }')
        page.wait_for_function('() => player.levels[1].panel', timeout=60000)
        page.evaluate('() => __step(70)')
        page.evaluate('(s) => player.levels[1].panel.startSkirmish(s)', settings)
        page.evaluate('(n) => __step(n)', 30 + args.warm)

        if args.probe or args.probe2 or args.probe3:
            probe = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe_canvas.js' if args.probe3 else 'probe_children.js' if args.probe2 else 'probe_draw.js'), encoding='utf-8').read()
            print(json.dumps(page.evaluate(probe, args.frames), indent=1))
            browser.close()
            server.shutdown()
            return
        if args.trace:
            browser.start_tracing(page=page, path=args.trace, categories=['devtools.timeline', 'v8', 'v8.gc', 'blink', 'cc', 'gpu', 'disabled-by-default-devtools.timeline', 'toplevel', 'blink.console'])
            page.evaluate('''(n) => { for (let i = 0; i < n; i++) { console.time('f' + i); player.tick(); player.draw(); console.timeEnd('f' + i); } }''', args.frames)
            browser.stop_tracing()
            browser.close()
            server.shutdown()
            return
        cdp = page.context.new_cdp_session(page)
        if args.drawonly:
            page.evaluate('() => { window.__drawOnly = true; }')
        if not args.noprofile:
            cdp.send('Profiler.enable')
            cdp.send('Profiler.setSamplingInterval', {'interval': 200})
            cdp.send('Profiler.start')
        timing = page.evaluate('''([n, draw]) => {
          const ticks = [], draws = [0];
          const r = player.renderer;
          for (let i = 0; i < n; i++) {
            let t = performance.now(); if (!window.__drawOnly || i === 0) player.tick(); ticks.push(performance.now() - t);
            // (A frame's drawing is only rasterised when the canvas is flushed; reading one pixel
            // back makes that happen now, so each frame is timed with its own raster work.)
            if (draw) { t = performance.now(); player.draw(); r.canvas.getContext('2d').getImageData(0, 0, 1, 1); draws.push(performance.now() - t); }
            if (i % 100 === 0) console.log('@' + i + ' heap ' + Math.round(performance.memory.usedJSHeapSize / 1e6) + 'MB tints ' + (r.tints ? r.tints.size : '-') + '/' + Math.round((r.tintPixels || 0) / 1e6) + 'Mpx fcache ' + (r.fcache ? r.fcache.size : '-') + '/' + Math.round((r.fcachePixels || 0) / 1e6) + 'Mpx scratch ' + (r.scratch ? r.scratch.length : '-') + ' tick ' + ticks[ticks.length - 1].toFixed(1) + ' draw ' + draws[draws.length - 1].toFixed(1));
          }
          const lv = player.levels[1].panel.game && player.levels[1].panel.game.level;
          const stats = (a) => { const s = a.slice().sort((x, y) => x - y); return { mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2),
            p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
          return { tick: stats(ticks), draw: stats(draws), units: lv && lv.units.filter((u) => u.active).length,
            buildings: lv && lv.buildings.filter((b) => b.active).length, mem: performance.memory && Math.round(performance.memory.usedJSHeapSize / 1e6),
            errors: [...player.errors.keys()] };
        }''', [args.frames, not args.nodraw])
        prof = cdp.send('Profiler.stop')['profile'] if not args.noprofile else {'nodes': [], 'samples': [], 'timeDeltas': []}
        browser.close()
    server.shutdown()

    print(json.dumps(timing))
    if errors:
        print('page errors:', errors[:5])
    # self time by function
    nodes = {n['id']: n for n in prof['nodes']}
    dt = prof.get('timeDeltas', [])
    samples = prof.get('samples', [])
    self_time = collections.Counter()
    for sid, d in zip(samples, dt):
        n = nodes[sid]
        cf = n['callFrame']
        key = '%s (%s:%d)' % (cf['functionName'] or '(anon)', os.path.basename(cf['url']) or '-', cf['lineNumber'] + 1)
        self_time[key] += d
    total = sum(self_time.values()) or 1
    print('\nself time, top %d:' % args.top)
    for key, t in self_time.most_common(args.top):
        print('%6.1f%%  %8.1f ms  %s' % (100.0 * t / total, t / 1000.0, key))


if __name__ == '__main__':
    main()
