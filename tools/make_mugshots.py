"""
The sidebar's pictures of what can be built (the game's "mugshots"), from their sources: the
original's Photoshop file of them (one layer for each faction's backdrop, one for each thing),
and an edited one adding the Hive, Santa, the Reindeer and Santa's Sleigh, with pictures of those
four exported as the game's are.

    python tools/make_mugshots.py [SOURCES]

SOURCES is the folder with "edited mugshots_big.psd" and mugshots_{hive,santa,reindeer,sleigh}.png
(by default ../../sources/assets/mugshots_big beside this repository).  It writes, at the game's
own size for them, 50x30:

- assets/online/icons/<type>.png: the four the game never had, as exported, for the sidebar as
  the game draws it (src/main.js ICONS; the game's own pictures for the rest);
- assets/online/mugshots/: for team-coloured icons (a player's setting), each thing apart from
  its backdrop -- back_good.png, back_evil.png, and <layer>.png, the thing with the white glow the
  game's pictures have round it -- so that each is coloured on its own: the backdrop's planet
  wholly in the player's colour, the thing where it wears its faction's;
- data/mugshots.json: those pictures' library ids, which pictures each type is drawn from, and
  the accent each is coloured by (as data/accents.json's: [hue, native colour, kept rows, band]).
"""

import colorsys
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from psd_tools import PSDImage

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SOURCES = os.path.normpath(os.path.join(ROOT, '..', '..', 'sources', 'assets', 'mugshots_big'))
SIZE = (50, 30)
# The white glow round a thing, as in the game's pictures (and the exports): its outline blurred
# this far (in the 500x300 source) and strengthened.
GLOW_BLUR = 8.5
GLOW_STRENGTH = 1.9
# The four the game never had: their layers and exports, and the types they are.
EXTRA = {'hive': 'BK_evil', 'santa': 'UM_evil', 'reindeer': 'UN_evil', 'sleigh': 'BJ_evil'}
# Layers standing for more than one type.
SHARED = {'UK': ['UK_good', 'UK_evil'], 'UJ_good': ['UJ_good', 'UJ_evil']}
# How the pictures are coloured (src/flash/render.js, Renderer.teamed, an accent's fifth part): each
# pixel keeps some of its own difference from the accent's hue (shade: the planet stays a gradient,
# red to yellow turning, say, cyan to indigo); and the black team's colour is a gunmetal, lighter
# on the backdrops, for the game's own black (a sprite's shadowed parts) would bury a picture.
SOFT = {'shade': 0.5, 'colours': {'black': {'h': 215, 's': 0.12, 'v': 0.5}}}
SOFT_BACK = {'shade': 0.5, 'colours': {'black': {'h': 215, 's': 0.12, 'v': 0.72}}}
# The backdrops' planets: the Astros' red to yellow, the Aliens' green and the glow at its edge
# (the sky's purples are left; the Aliens' two hues, far apart, keep less of their difference).
BACK_ACCENT = {'good': [15.0, 'orange', [], 30, SOFT_BACK], 'evil': [45.0, 'green', [], 46, dict(SOFT_BACK, shade=0.3)]}
# Not coloured at all (only the backdrop behind them): the pizza, the soccer pitch.
PLAIN = {'UJ_good', 'BI_good'}
BASE_ID = 991000


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SOURCES
    psd = PSDImage.open(os.path.join(src, 'edited mugshots_big.psd'))
    layers = {layer.name: layer for layer in psd}

    def layer_img(name):
        layer = layers[name]
        im = Image.new('RGBA', psd.size, (0, 0, 0, 0))
        im.alpha_composite(layer.topil().convert('RGBA'), (max(0, layer.left), max(0, layer.top)),
                           (max(0, -layer.left), max(0, -layer.top)))
        return im

    def small(im):
        return im.convert('RGBa').resize(SIZE, Image.LANCZOS).convert('RGBA')

    def glowed(obj):
        a = obj.getchannel('A').filter(ImageFilter.GaussianBlur(GLOW_BLUR))
        glow = Image.new('RGBA', obj.size, (255, 255, 255, 0))
        glow.putalpha(Image.fromarray(np.minimum(255, np.asarray(a, dtype=np.float32) * GLOW_STRENGTH).astype(np.uint8)))
        glow.alpha_composite(obj)
        return glow

    def accent_of(im, low, high):
        hist = [0] * 360
        for r, g, b, a in im.get_flattened_data():
            if a < 200:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s >= 0.30 and v >= 0.15:
                hist[int(h * 360) % 360] += 1
        best, at = -1, 0
        for start in range(360):
            if low <= (start + 22) % 360 <= high:
                total = sum(hist[(start + d) % 360] for d in range(45))
                if total > best:
                    best, at = total, start
        return float((at + 22) % 360)

    def accent_for(name, side, im):
        if name in PLAIN:
            return None
        if name in ('santa', 'sleigh'):
            return [accent_of(im, 0, 359), 'none', [], 22, SOFT]         # (their red, whatever the player)
        if name == 'reindeer':
            return [accent_of(im, 0, 359), 'none', [], 12, SOFT]         # (the nose and harness; the coat stays brown)
        if name == 'UQ_evil':
            return [135.0, 'green', [], 25, SOFT]                           # (his teal-green; the head and its yellow eyes stay)
        if name == 'hive':
            return [accent_of(im, 45, 135), 'green', [], 22, SOFT]
        if side == 'good':
            return [30.0, 'orange', [], 17, SOFT]                           # (13 to 47: the visors' gold, not the faces' yellow, 48 on)
        return [106.0, 'green', [], 58, dict(SOFT, minSat=0.12)]            # (the Aliens' yellow-greens to teals, pale mints too)

    out_icons = os.path.join(ROOT, 'assets', 'online', 'icons')
    out_mug = os.path.join(ROOT, 'assets', 'online', 'mugshots')
    os.makedirs(out_icons, exist_ok=True)
    os.makedirs(out_mug, exist_ok=True)

    # the four the game never had, as exported
    for name, kind in EXTRA.items():
        Image.open(os.path.join(src, 'mugshots_%s.png' % name)).convert('RGB').resize(SIZE, Image.LANCZOS).save(os.path.join(out_icons, kind + '.png'))

    table = {'backdrops': {}, 'pictures': {}, 'types': {}}
    next_id = BASE_ID + 1
    for side in ('good', 'evil'):
        small(layer_img(side)).convert('RGB').save(os.path.join(out_mug, 'back_%s.png' % side))
        table['backdrops'][side] = {'id': next_id, 'file': 'back_%s.png' % side, 'accent': BACK_ACCENT[side]}
        next_id += 1
    names = [n for n in layers if n not in ('Background', 'good', 'evil')]
    for name in sorted(names):
        side = 'evil' if name in EXTRA or name.endswith('_evil') else 'good'
        im = small(glowed(layer_img(name)))
        im.save(os.path.join(out_mug, name + '.png'))
        table['pictures'][name] = {'id': BASE_ID + 100 + len(table['pictures']), 'file': name + '.png', 'accent': accent_for(name, side, im)}
        for kind in SHARED.get(name, [EXTRA.get(name, name)]):
            table['types'][kind] = {'picture': name, 'backdrop': kind[-4:]}
    with open(os.path.join(ROOT, 'data', 'mugshots.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(table, fh, indent=1, sort_keys=True)
    print('%d pictures, %d types -> assets/online/mugshots, data/mugshots.json; the four extras -> assets/online/icons'
          % (len(table['pictures']), len(table['types'])))


if __name__ == '__main__':
    main()
