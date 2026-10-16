"""The installed web app (sw.js, manifest.webmanifest, src/online/offline.js): in a headless
Chromium, the browser finds nothing that keeps it from being installed; after a first visit all
of this version's files are kept; an older version's are let go; with the network cut off, the
page loads again, the game starts and a skirmish plays; and the settings say how to install it.

    python tools/verify/offline.py                    (the repository, served here)
    python tools/verify/offline.py --url https://caconline.viosarcade.xyz/
"""
import argparse
import functools
import http.server
import os
import re
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default=None)
    ap.add_argument('--port', type=int, default=8797)
    args = ap.parse_args()
    server = None
    url = args.url
    if not url:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Quiet, directory=ROOT))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = 'http://127.0.0.1:%d/' % args.port
    sw = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    version = re.search(r"const VERSION = '([^']*)'", sw).group(1)
    files = re.findall(r'^  "([^"]+)"', sw, re.M)
    failures = []

    def check(ok, what):
        print(('ok    ' if ok else 'FAIL  ') + what)
        if not ok:
            failures.append(what)

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={'width': 1100, 'height': 700})
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        # (an older version's cache, to be let go)
        page.goto(url + 'manifest.webmanifest')
        page.evaluate("async () => { const c = await caches.open('cac-older'); await c.put('/older', new Response('x')); }")
        page.goto(url)
        page.wait_for_function('() => navigator.serviceWorker && navigator.serviceWorker.controller', timeout=120000)
        cdp = ctx.new_cdp_session(page)
        errors = cdp.send('Page.getInstallabilityErrors').get('installabilityErrors', [])
        check(not errors, 'installable (errors: %s)' % [e.get('errorId') for e in errors])
        kept = page.evaluate('''async (v) => { const names = await caches.keys(); const c = await caches.open('cac-' + v);
          return { names, urls: (await c.keys()).map((r) => r.url) }; }''', version)
        urls = set(kept['urls'])
        missing = [f for f in files if not any(u.endswith('/' + f.replace(' ', '%20')) for u in urls)]
        check(not missing, 'all %d files of version %s kept (missing: %s)' % (len(files), version, missing[:5]))
        check(kept['names'] == ['cac-' + version], 'only this version kept (caches: %s)' % kept['names'])
        # offline: loaded again, the game starts and plays
        ctx.set_offline(True)
        page.reload()
        page.wait_for_function('() => window.player && player.levels[0] && player.levels[0].$cur >= 15', timeout=120000)
        xy = page.evaluate('''() => { const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
          const x = 300 + Math.round((r.stageW - 600) / 2), y = 373 + Math.round((r.stageH - 400) / 2);
          return [b.left + (r.offsetX + x * r.scale) / d, b.top + (r.offsetY + y * r.scale) / d]; }''')
        page.mouse.click(*xy)
        page.wait_for_function('() => window.onlineUI && onlineUI.attached', timeout=180000)
        check(True, 'offline: the page loaded and the game started')
        page.evaluate("() => { onlineUI.open('lobby'); onlineUI.start(); }")
        page.wait_for_function('() => { const g = player.levels[1].panel.game; return !!(g && g.level && g.level.count > 100); }', timeout=120000)
        check(True, 'offline: a skirmish plays')
        page.evaluate('() => player.levels[1].panel.game.hud.pressQuit()')
        time.sleep(1)
        page.evaluate("() => onlineUI.open('settings')")
        time.sleep(0.5)
        text = page.evaluate("() => (document.querySelector('.appbox') || {}).textContent || ''")
        check('install' in text.lower() or 'installed' in text.lower(), 'the settings say how to install it: %r' % text[:120])
        check(not errs, 'no errors (%s)' % errs[:2])
        b.close()
    if server:
        server.shutdown()
    print('FAILED: %d' % len(failures) if failures else 'all passed')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
