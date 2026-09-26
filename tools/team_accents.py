"""
Which pixels of the unit and building art are the faction's colour, for team colours.

    python tools/team_accents.py            -> data/accents.json

Every unit and building type has an accent: the hue its faction colour is painted in (the
Astros' orange, the Aliens' green, the gold of an Astro trooper's visor).  The player's
colour replaces that hue and nothing else -- each pixel keeps its own saturation and value,
so the art keeps its shading.  This is the method of the Command & Conquer mod's
make_cnc_hd.py (team_colour, dominant_accent), with the same constants.

The accent is found per type, across all of that type's frames, so that it cannot wobble
between facings, and only among the faction's own colours: an Astro's is an orange or a gold,
an Alien's a yellow-green or a green (the Radar Station's dish is blue, and stays blue).  The
output maps each bitmap's character id to [accent hue in degrees, native colour]; the native
colour is the one the art is already painted in (orange for the Astros, green for the Aliens),
which needs no repainting.  The baseplates are grey, with no accent: they are coloured all
over (hue -1).  Santa's Sleigh, Santa and the Reindeer, which a skirmish's present lets anyone
build, are coloured as the mod colours them: their accent is looked for all round the colour
wheel (Santa's red, say), and they have no native colour, so every player's repaints them.
Pickups and the other one-off pieces keep their own colours, apart from
the pizza's box, which is its buyer's (Pizza Mode): its entry adds the pixels to leave alone,
the pizza in the box, as rows of [y, first x, last x].  The Amaze level's flag, which Capture
the Flag gives every player, has a white cloth and no accent: hue -2 colours its pale pixels.
The tutorial's arrows, which Capture the Flag puts over a flag's carrier, are coloured too.
"""

import colorsys
import io
import json
import os

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

TEAM_MIN_SAT = 0.30             # below this a pixel is neutral, and left alone
TEAM_MIN_VAL = 0.15
WINDOW = 45                     # degrees: the widest-support window wins
MIN_SUPPORT = 40                # pixels, below which a type has no accent

# Where the automatic choice picks the wrong thing (as in the mod): the Astro troopers are
# white apart from a gold visor, and a small blue light outweighs it in a pixel count.
ACCENT_OVERRIDE = {
    'UA_good': 32.0,
    'UB_good': 32.0,
}

# Where the band either side of the accent (22 degrees, as the mod's) leaves some of it out: the
# Astro Defence Station's turret, one facing of which has its orange run to yellow (55-60).
ACCENT_BAND = {
    'BD_good': 26.0,
}

# Where each faction's accent may lie: window centres, in degrees ('wheel': anywhere).
ACCENT_RANGE = {'orange': (12, 52), 'green': (45, 135), 'wheel': (0, 359)}

# Not a player's: pickups (UI crates, UJ the pizza, UO the presents), the soccer pitch (BI) and
# the story's rocket (BX).
NOT_TEAM = {'UI_good', 'UI_evil', 'UJ_good', 'UJ_evil', 'UO_evil', 'BI_good', 'BX_good'}

# Anyone's, with their accent anywhere on the wheel (see above): Santa's Sleigh, Santa and the
# Reindeer.
WHEEL = {'UM_evil', 'UN_evil', 'BJ_evil'}

HUD_BITMAPS = {4511: 'good', 4567: 'evil'}   # the sidebar's frame art, and the Aliens' top bar
ARROWS = {4529: 'good', 4532: 'evil'}          # the tutorial's arrows (the indicator's 'arrow')
FLAG = 4448                                    # the flag, a tile of the Amaze level

# The pizza's box is a pure red (hues 356-4, fully saturated); the pizza in it is everything
# else -- crust, cheese and pepperoni, some of which are the box's reds too, so the pizza is
# taken as the area its own colours span, row by row and column by column.
PIZZA = 'UJ_good'
PIZZA_RED = 2.0


def pizza_keep(img):
    """The pizza in its box, as rows of [y, first x, last x]."""
    w, h = img.size
    px = img.load()

    def box(r, g, b):
        hue, s, _ = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        hue *= 360
        return s >= 0.95 and (hue <= 4 or hue >= 356)

    food = [(x, y) for y in range(h) for x in range(w)
            if px[x, y][3] and max(px[x, y][:3]) > 40 and not box(*px[x, y][:3])]
    rows, cols = {}, {}
    for x, y in food:
        lo, hi = rows.get(y, (x, x))
        rows[y] = (min(lo, x), max(hi, x))
        lo, hi = cols.get(x, (y, y))
        cols[x] = (min(lo, y), max(hi, y))
    keep = []
    for y in sorted(rows):
        xs = [x for x in range(rows[y][0], rows[y][1] + 1) if x in cols and cols[x][0] <= y <= cols[x][1]]
        if xs:
            keep.append([y, xs[0], xs[-1]])
    return keep


def main():
    game = json.load(open(os.path.join(ROOT, 'data', 'game.json'), encoding='utf-8'))
    chars = game['chars']
    pack = open(os.path.join(ROOT, 'assets', 'game', 'bitmaps.bin'), 'rb').read()
    images = {}

    def image(bid):
        if bid not in images:
            at, ln = chars[str(bid)]['pack']
            images[bid] = Image.open(io.BytesIO(pack[at:at + ln])).convert('RGBA')
        return images[bid]

    def bitmaps(cid, out, seen):
        """Every bitmap drawn anywhere under a character."""
        if cid in seen:
            return
        seen.add(cid)
        ch = chars.get(str(cid), {})
        if ch.get('t') == 'sprite':
            for frame in ch['frames']:
                for op in frame:
                    if op.get('c') is not None:
                        bitmaps(op['c'], out, seen)
        elif ch.get('t') == 'shape':
            if ch.get('bmp'):
                out.add(ch['bmp']['id'])
            for layer in ch.get('layers', []):
                for fill in layer.get('fills', []):
                    if fill['s'].get('t') == 'bitmap' and fill['s'].get('id') in chars:
                        out.add(fill['s']['id'])

    def label_contents(symbol, label, names=None):
        """The characters a symbol's labelled frame shows (only those placed under the given
        instance names, if any: a unit's art, not its health bar)."""
        ch = chars[str(game['exports'][symbol])]
        target = ch['labels'][label]
        shown = {}
        for i, frame in enumerate(ch['frames'][:target]):
            for op in frame:
                if op.get('o') == 'P':
                    shown[op['d']] = (op.get('c'), op.get('n'))
                elif op.get('o') == 'X':
                    shown.pop(op['d'], None)
                elif op.get('o') == 'R' and op.get('c') is not None and op['d'] in shown:
                    shown[op['d']] = (op['c'], shown[op['d']][1])
        return [c for c, n in shown.values() if c is not None and (names is None or n in names)]

    def accent_of(ids, native):
        low, high = ACCENT_RANGE[native]
        hist = [0] * 360
        for bid in ids:
            for r, g, b, a in image(bid).get_flattened_data():
                if a < 200:
                    continue
                h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
                if s < TEAM_MIN_SAT or v < TEAM_MIN_VAL:
                    continue
                hist[int(h * 360) % 360] += 1
        best, best_at = -1, 0
        for start in range(360):
            if not low <= (start + WINDOW // 2) % 360 <= high:
                continue
            total = sum(hist[(start + d) % 360] for d in range(WINDOW))
            if total > best:
                best, best_at = total, start
        if best < MIN_SUPPORT:
            return None
        return float((best_at + WINDOW // 2) % 360)

    out = {}
    report = []

    def record(name, ids, native, hue=None):
        if name in NOT_TEAM:
            return
        if hue is None:
            hue = ACCENT_OVERRIDE.get(name)
        if hue is None:
            hue = accent_of(ids, native)
        report.append('%-12s %-6s %s  (%d bitmaps)' % (name, native, '-' if hue is None else '%5.1f' % hue, len(ids)))
        if hue is None:
            return
        entry = [hue, native] if name not in ACCENT_BAND else [hue, native, [], ACCENT_BAND[name]]
        for bid in ids:
            out.setdefault(str(bid), entry)

    for symbol in ('unit', 'building'):
        labels = chars[str(game['exports'][symbol])]['labels']
        for label in sorted(labels):
            ids = set()
            for cid in label_contents(symbol, label, ('unit', 'building')):
                bitmaps(cid, ids, set())
            record(label, sorted(ids), 'wheel' if label in WHEEL else 'orange' if label.endswith('_good') else 'green')
    labels = chars[str(game['exports']['baseplate'])]['labels']
    for label in sorted(labels):
        ids = set()
        for cid in label_contents('baseplate', label):
            bitmaps(cid, ids, set())
        record('baseplate:' + label, sorted(ids), '', hue=-1.0)
    for bid, side in HUD_BITMAPS.items():
        record('hud:%d' % bid, [bid], 'orange' if side == 'good' else 'green')
    for bid, side in ARROWS.items():
        record('arrow:%d' % bid, [bid], 'orange' if side == 'good' else 'green')
    out[str(FLAG)] = [-2.0, 'white']
    report.append('%-12s %-6s %5.1f  (the cloth)' % ('flag:%d' % FLAG, 'white', -2.0))
    ids = set()
    for cid in label_contents('unit', PIZZA, ('unit',)):
        bitmaps(cid, ids, set())
    for bid in sorted(ids):
        out[str(bid)] = [PIZZA_RED, 'red', pizza_keep(image(bid))]
        report.append('%-12s %-6s %5.1f  (bitmap %d, the pizza kept in %d rows)' % (PIZZA, 'red', PIZZA_RED, bid, len(out[str(bid)][2])))

    path = os.path.join(ROOT, 'data', 'accents.json')
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(out, fh, separators=(',', ':'), sort_keys=True)
    print('\n'.join(report))
    print('%d bitmaps -> %s' % (len(out), os.path.relpath(path, ROOT)))


if __name__ == '__main__':
    main()
