"""Shared custom maps' pictures, drawn again in the game's own art: the game, headless, draws each
map on the server as its Browser does (src/online/custom.js thumbnail), and the picture goes to the
server (POST /maps/admin/ID {action: 'thumb'}), which shows it as the map's preview and puts it
on the map's review post in Discord.  For maps shared before the game sent its own picture, or
after the game's art or the thumbnail changes.

    python tools/maps/rethumb.py [--all] [--server URL] [--key-file PATH]

Without --all, only the maps that have no picture of their own.  The ADMIN_KEY is read from
--key-file (default: crystalien-admin-key.txt in the home folder) and never printed.
"""

import argparse
import functools
import http.server
import json
import os
import threading
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.log_message = lambda *a: None
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def admin(server, key, path, body=None):
    req = urllib.request.Request(server + '/maps/admin/' + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'rethumb'},
                                 method='POST' if body is not None else 'GET')
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def boot(page, port):
    """The game, its menus attached (as the tests start it: tools/verify)."""
    page.goto('http://127.0.0.1:%d/index.html?test&menus&seed=1' % port)
    page.wait_for_function('() => window.player && player.levels[0]', timeout=300000)
    page.evaluate('() => { while (player.levels[0].$cur < 15) __step(1); }')
    xy = page.evaluate('''() => { const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
      const x = 300 + Math.round((r.stageW - 600) / 2), y = 373 + Math.round((r.stageH - 400) / 2);
      return [b.left + (r.offsetX + x * r.scale) / d, b.top + (r.offsetY + y * r.scale) / d]; }''')
    page.mouse.click(*xy)
    page.wait_for_function('() => player.levels[1] && !player.levels[1].$pending', timeout=300000)
    page.evaluate('() => { let n = 0; while (player.levels[1].$cur !== 201 && n++ < 1000) __step(1); }')
    for _ in range(400):
        if page.evaluate('() => { __step(5); return !!(window.onlineUI && onlineUI.attached && onlineUI.custom.art.ready()); }'):
            return
    raise SystemExit('the game did not start')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--server', default='https://cacserver.viosarcade.xyz')
    ap.add_argument('--key-file', default=os.path.join(os.path.expanduser('~'), 'crystalien-admin-key.txt'))
    ap.add_argument('--all', action='store_true', help='every map, not only those without a picture of their own')
    args = ap.parse_args()
    key = open(args.key_file, encoding='utf-8').read().strip().strip('"\'')
    maps = admin(args.server, key, 'all')['maps']
    todo = [m for m in maps if args.all or not m['pictured']]
    print('%d maps, %d to draw' % (len(maps), len(todo)))
    if not todo:
        return
    httpd = serve()
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        boot(page, httpd.server_address[1])
        for m in todo:
            pic = page.evaluate('''async (map) => {
              const C = await import('./src/online/cacmap.js');
              const v = C.validate(JSON.parse(JSON.stringify(map)));
              return v.ok ? onlineUI.custom.thumbnail(v.map).toDataURL('image/jpeg', 0.85).split(',')[1] : null; }''', m['map'])
            if not pic:
                print('  %s %-32s not a map the game can draw' % (m['id'], m['name']))
                continue
            r = admin(args.server, key, m['id'], {'action': 'thumb', 'thumb': pic})
            print('  %s %-32s %dx%d %s%s' % (m['id'], m['name'], r['w'], r['h'], r['type'], ', its post updated' if r.get('posted') else ''))
        browser.close()
    httpd.shutdown()


if __name__ == '__main__':
    main()
