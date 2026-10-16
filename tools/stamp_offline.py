"""The installed game's files (sw.js): every file the page can load -- index.html, the web app
manifest, src/, data/ and assets/, as they are about to be committed (git's index) -- and a
version named by their contents, written into sw.js between its stamp lines.  A changed sw.js is
how a browser learns of a new version; the worker keeps each version's files whole (sw.js says
why).  Run by the pre-commit hook (tools/hooks/pre-commit; git config core.hooksPath tools/hooks).

    python tools/stamp_offline.py           (writes sw.js; prints the version and the count)
    python tools/stamp_offline.py --check   (says whether sw.js is up to date)
"""
import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
WANT = ['index.html', 'manifest.webmanifest', 'src', 'data', 'assets']
SW = os.path.join(ROOT, 'sw.js')
BLOCK = re.compile(r'(// stamp: tools/stamp_offline\.py\n)(.*?)(// /stamp\n)', re.S)


def files():
    out = subprocess.run(['git', 'ls-files', '-s', '--'] + WANT, cwd=ROOT, capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines():
        meta, path = line.split('\t', 1)
        rows.append((path, meta.split()[1]))
    rows.sort()
    return rows


def stamp():
    rows = files()
    version = hashlib.sha1('\n'.join(p + ' ' + h for p, h in rows).encode()).hexdigest()[:12]
    body = "const VERSION = '%s';\nconst FILES = [\n%s\n];\n" % (version, ',\n'.join('  ' + json.dumps(p) for p, _ in rows))
    return version, len(rows), body


def main():
    src = open(SW, encoding='utf-8', newline='').read()
    version, count, body = stamp()
    new = BLOCK.sub(lambda m: m.group(1) + body + m.group(3), src, count=1)
    if '--check' in sys.argv:
        print('sw.js up to date' if new == src else 'sw.js out of date: run tools/stamp_offline.py')
        sys.exit(0 if new == src else 1)
    if new != src:
        open(SW, 'w', encoding='utf-8', newline='').write(new)
    print('sw.js: version %s, %d files' % (version, count))


if __name__ == '__main__':
    main()
