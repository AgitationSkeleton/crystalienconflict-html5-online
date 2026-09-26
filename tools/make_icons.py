"""
Sidebar pictures the game never had, for what a skirmish lets a player build: the Alien
Hive (Special Ops), and Santa's Sleigh, Santa and the Reindeer (a Christmas present's).

    python tools/make_icons.py [MOD]      -> assets/online/icons/<type>.png

They are the Command & Conquer mod's (CrystAlien Conflict Factions, made by its
tools/make_build_icons.py): each object's own art on its faction's backdrop, the backdrop
recovered from the game's own pictures.  The mod scales them up into C&C's 256x256 sidebar
icons, on a gradient; this takes them back out at the sidebar's 50x30.  MOD is the mod's
built folder (by default the one beside this repository's).  (The Aliens' pizza shows the
Astros' picture: it is the same pizza.)
"""

import os
import sys

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
MOD = os.path.normpath(os.path.join(ROOT, '..', '..', '..', 'COMMANDANDCONQUER', 'workfolders',
                                    'cac-crystalien-factions', 'mod', 'CrystAlienConflict'))
TYPES = ('BK_evil', 'BJ_evil', 'UM_evil', 'UN_evil')
ICON_W, ICON_H = 50, 30


def picture(tga):
    """The picture inside one of the mod's icons: where its rows stop being the plain
    gradient behind it."""
    im = Image.open(tga).convert('RGB')
    w, h = im.size
    px = im.load()
    rows = [y for y in range(h) if len({px[x, y] for x in range(w)}) > 1]
    cols = [x for x in range(w) if any(px[x, y] != px[0, y] for y in rows)]
    return im.crop((cols[0], rows[0], cols[-1] + 1, rows[-1] + 1))


def main():
    mod = sys.argv[1] if len(sys.argv) > 1 else MOD
    out = os.path.join(ROOT, 'assets', 'online', 'icons')
    os.makedirs(out, exist_ok=True)
    for kind in TYPES:
        tga = os.path.join(mod, 'Data', 'Art', 'Textures', 'sRGB', 'BuildIcon_TD_%s.tga' % kind.replace('_', '').upper())
        icon = picture(tga).resize((ICON_W, ICON_H), Image.LANCZOS)
        path = os.path.join(out, kind + '.png')
        icon.save(path)
        print(os.path.relpath(path, ROOT))


if __name__ == '__main__':
    main()
