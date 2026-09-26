"""
How smoothly a skirmish plays: run the game on its own clock in Chromium with the GPU (as a
browser on this machine would) and report the screen's frames -- how far apart they came, how
many were late -- and the game's work in each.

    python tools/verify/fps.py [--map lego-mp26] [--palette snowy] [--mode pizza] [--bots 3]
                               [--warm 600] [--seconds 20] [--viewport 1600x900] [--dpr 1]
                               [--software] [--zoom 0.5] [--scroll]

After --warm frames stepped (the bases grow), the clock runs for --seconds.  A frame that
comes more than 1.5 refreshes after the last is late (one or more were dropped).  --scroll pans
the view back and forth while it runs; --zoom sets the view's zoom first.  --software uses
Chromium without the GPU (as the other tools do).
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
    ap.add_argument('--warm', type=int, default=600)
    ap.add_argument('--seconds', type=float, default=20)
    ap.add_argument('--viewport', default='1600x900')
    ap.add_argument('--dpr', type=float, default=1)
    ap.add_argument('--port', type=int, default=8792)
    ap.add_argument('--software', action='store_true')
    ap.add_argument('--zoom', type=float, default=None)
    ap.add_argument('--scroll', action='store_true')
    ap.add_argument('--settings', default=None, help='JSON merged into the match settings, e.g. {"crates": true}')
    ap.add_argument('--trace', default=None, help='write a Chromium trace of the run (all processes) to this file')
    ap.add_argument('--exp', default=None, help='instead of running the clock, evaluate this JS file (a function) and print what it returns')
    ap.add_argument('--probe', action='store_true', help='time the images drawn, by kind and size (probe_sources.js)')
    ap.add_argument('--profile', type=int, default=0, help='also a CPU profile of the run: the top N functions by own time')
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
    if args.settings:
        settings.update(json.loads(args.settings))

    with sync_playwright() as pw:
        if args.software:
            browser = pw.chromium.launch()
        else:
            browser = pw.chromium.launch(channel='chromium', args=['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'])
        page = browser.new_page(viewport={'width': vw, 'height': vh}, device_scale_factor=args.dpr)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://127.0.0.1:%d/index.html?test&seed=1' % args.port)
        gpu = page.evaluate('''() => { const gl = document.createElement('canvas').getContext('webgl');
          const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }''')
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
        page.evaluate('(s) => player.levels[1].panel.startSkirmish(s)', settings)
        page.evaluate('(n) => __step(n)', 30 + args.warm)
        if args.zoom:
            page.evaluate('''(z) => { const a = player.levels[1].panel.game.level.arena; a.zoom = z; if (a.fitView) a.fitView(); __step(2); }''', args.zoom)
        if args.exp:
            print(json.dumps(page.evaluate(open(args.exp, encoding='utf-8').read()), indent=1))
            browser.close()
            server.shutdown()
            return
        cdp = None
        if args.profile:
            cdp = page.context.new_cdp_session(page)
            cdp.send('Profiler.enable')
            cdp.send('Profiler.setSamplingInterval', {'interval': 1000})
            cdp.send('Profiler.start')
        if args.trace:
            browser.start_tracing(page=page, path=args.trace, categories=['devtools.timeline', 'v8', 'blink', 'cc', 'gpu', 'viz', 'skia', 'disabled-by-default-devtools.timeline', 'toplevel', 'benchmark', 'disabled-by-default-skia', 'disabled-by-default-gpu.service', 'disabled-by-default-cc.debug'])
        if args.probe:
            page.evaluate(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe_sources.js'), encoding='utf-8').read())
        # Watch the frames: when each came, and how long the game's ticks and drawing took in it.
        page.evaluate('''() => {
          const f = window.__frames = { at: [], work: [], ticks: 0, draws: 0, tickMs: [], drawMs: [] };
          let work = 0;
          const tick = player.tick.bind(player), draw = player.draw.bind(player);
          player.tick = function () { const t = performance.now(); tick(); const d = performance.now() - t; work += d; f.tickMs.push(d); f.ticks++; };
          player.draw = function (a) { const t = performance.now(); draw(a); const d = performance.now() - t; work += d; f.drawMs.push(d); f.draws++; };
          const rec = (now) => { f.at.push(now); f.work.push(work); work = 0; if (!f.stop) requestAnimationFrame(rec); };
          requestAnimationFrame(rec);
          __run();
        }''')
        if args.scroll:
            # pan with the arrow keys, a second each way
            steps = int(args.seconds)
            for i in range(steps):
                key = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'][i % 4]
                page.keyboard.down(key)
                page.wait_for_timeout(1000)
                page.keyboard.up(key)
        else:
            page.wait_for_timeout(int(args.seconds * 1000))
        out = page.evaluate('''() => {
          const f = window.__frames; f.stop = true;
          const gaps = []; for (let i = 1; i < f.at.length; i++) gaps.push(f.at[i] - f.at[i - 1]);
          const stats = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y);
            return { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: +s[Math.floor(s.length * 0.5)].toFixed(2),
              p95: +s[Math.floor(s.length * 0.95)].toFixed(2), p99: +s[Math.floor(s.length * 0.99)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
          const refresh = gaps.slice().sort((x, y) => x - y)[Math.floor(gaps.length * 0.1)] || 16.7;
          const late = gaps.filter((g) => g > refresh * 1.5).length;
          const secs = (f.at[f.at.length - 1] - f.at[0]) / 1000;
          const lv = player.levels[1].panel.game && player.levels[1].panel.game.level;
          return { seconds: +secs.toFixed(1), fps: +(gaps.length / secs).toFixed(1), refresh: +refresh.toFixed(2), late, lateShare: +(late / gaps.length).toFixed(3),
            ticksPerSecond: +(f.ticks / secs).toFixed(1), gap: stats(gaps), work: stats(f.work), tick: stats(f.tickMs), draw: stats(f.drawMs),
            units: lv && lv.units.filter((u) => u.active).length, buildings: lv && lv.buildings.filter((b) => b.active).length,
            errors: [...player.errors.keys()], sources: window.__sources };
        }''')
        prof = cdp.send('Profiler.stop')['profile'] if cdp else None
        if args.trace:
            browser.stop_tracing()
        browser.close()
    server.shutdown()
    out['gpu'] = gpu
    sources = out.pop('sources', None)
    print(json.dumps(out, indent=1))
    if sources:
        print('images drawn (ms in the canvas call, how many):')
        for k, v in sorted(sources.items(), key=lambda kv: -kv[1]['ms'])[:25]:
            print('  %8.1f ms %7d  %s' % (v['ms'], v['n'], k))
    if errors:
        print('page errors:', errors[:5])
    if prof:
        nodes = {n['id']: n for n in prof['nodes']}
        own = collections.Counter()
        for sid, d in zip(prof.get('samples', []), prof.get('timeDeltas', [])):
            cf = nodes[sid]['callFrame']
            own['%s (%s:%d)' % (cf['functionName'] or '(anon)', os.path.basename(cf['url']) or '-', cf['lineNumber'] + 1)] += d
        total = sum(own.values()) or 1
        print('\nown time, top %d:' % args.profile)
        for key, t in own.most_common(args.profile):
            print('%6.1f%%  %8.1f ms  %s' % (100.0 * t / total, t / 1000.0, key))
        # and for the browser's own drawing calls, who calls them
        parent = {}
        for n in prof['nodes']:
            for c in n.get('children', []):
                parent[c] = n['id']
        name = lambda i: '%s (%s:%d)' % (nodes[i]['callFrame']['functionName'] or '(anon)', os.path.basename(nodes[i]['callFrame']['url']) or '-', nodes[i]['callFrame']['lineNumber'] + 1)
        callers = collections.defaultdict(collections.Counter)
        for sid, d in zip(prof.get('samples', []), prof.get('timeDeltas', [])):
            fn = nodes[sid]['callFrame']['functionName']
            if fn in ('drawImage', 'fillRect', 'getImageData', 'putImageData'):
                chain = []
                i = parent.get(sid)
                while i is not None and len(chain) < 3:
                    chain.append(name(i))
                    i = parent.get(i)
                callers[fn][' < '.join(chain)] += d
        for fn, c in callers.items():
            print('\n%s, from:' % fn)
            for key, t in c.most_common(8):
                print('  %8.1f ms  %s' % (t / 1000.0, key))


if __name__ == '__main__':
    main()
