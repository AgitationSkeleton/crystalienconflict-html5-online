"""
The offline client (client/): start it, reach its window through Chromium's debugging port, and
check the game loads from its own files (app://game), the menus come up, a skirmish starts, and
the app says it is the app.  With --exe, a built app (client/dist/win-unpacked/...exe) instead
of the one run from the repository.

    python tools/verify/app.py [--exe PATH]
"""

import argparse
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CLIENT = os.path.join(ROOT, 'client')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--exe', default=None)
    ap.add_argument('--port', type=int, default=9333)
    ap.add_argument('--server', default=None, help='also host a game on this server (a local one: server/, npm run dev)')
    args = ap.parse_args()
    if args.exe:
        cmd = [args.exe, '--remote-debugging-port=%d' % args.port]
    else:
        cmd = [os.path.join(CLIENT, 'node_modules', 'electron', 'dist', 'electron.exe'), CLIENT, '--remote-debugging-port=%d' % args.port]
    # (An editor built on Electron may have set ELECTRON_RUN_AS_NODE for what it runs: then
    # Electron is only Node.)
    if args.server:
        cmd.append('--server=' + args.server)
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    failures = []

    def check(cond, what):
        print(('ok   ' if cond else 'FAIL ') + what, flush=True)
        if not cond:
            failures.append(what)

    try:
        with sync_playwright() as pw:
            browser = None
            for _ in range(60):
                try:
                    browser = pw.chromium.connect_over_cdp('http://127.0.0.1:%d' % args.port)
                    break
                except Exception:
                    time.sleep(0.5)
            check(browser is not None, 'the app starts')
            page = None
            for _ in range(60):
                pages = [p for c in browser.contexts for p in c.pages]
                page = next((p for p in pages if p.url.startswith('app://')), None)
                if page:
                    break
                time.sleep(0.5)
            check(page is not None and page.url.startswith('app://game/'), 'its window shows the game from its own files: %s' % (page and page.url))
            page.wait_for_function('() => window.player && player.levels[0] && player.levels[0].$cur >= 15', timeout=60000)
            xy = page.evaluate('''() => { const r = player.renderer, b = r.canvas.getBoundingClientRect(), d = r.canvas.width / b.width;
              const x = 300 + Math.round((r.stageW - 600) / 2), y = 373 + Math.round((r.stageH - 400) / 2);
              return [b.left + (r.offsetX + x * r.scale) / d, b.top + (r.offsetY + y * r.scale) / d]; }''')
            page.mouse.click(*xy)
            page.wait_for_function('() => window.onlineUI && onlineUI.attached', timeout=120000)
            check(True, 'the game loads and the menus come up')
            check(page.evaluate('() => !!(window.crystalienApp && crystalienApp.version)'), 'the page knows it is the app: version %s' % page.evaluate('() => window.crystalienApp && crystalienApp.version'))
            if args.server:
                page.evaluate("() => onlineUI.show('online')")
                page.evaluate('() => onlineUI.host()')
                try:
                    page.wait_for_function('() => onlineUI.net.room && onlineUI.net.isHost', timeout=20000)
                    check(True, 'the app hosts a game on the server: ' + page.evaluate('() => onlineUI.net.code'))
                except Exception:
                    check(False, 'the app hosts a game: ' + page.evaluate("() => onlineUI.onlineNotice.textContent"))
                page.evaluate('() => onlineUI.net.leave()')
            page.evaluate('() => onlineUI.show("settings")')
            time.sleep(0.5)
            page.screenshot(path=os.path.join(ROOT, 'work', 'app-settings.png'))
            page.evaluate('() => { onlineUI.show("lobby"); onlineUI.start(); }')
            page.wait_for_function('() => { const g = player.levels[1].panel.game; return g && g.level && g.level.count > 60; }', timeout=60000)
            check(True, 'a skirmish plays')
            page.screenshot(path=os.path.join(ROOT, 'work', 'app-game.png'))
            errs = page.evaluate('() => [...player.errors.keys()]')
            check(not errs, 'no script errors %s' % errs)
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except Exception:
            proc.kill()
    print('all passed' if not failures else '%d failed' % len(failures))
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
