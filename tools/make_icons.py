"""
Sidebar pictures the game never had, for what a skirmish lets a player build.

    python tools/make_icons.py            -> assets/online/icons/<type>.png

The Alien Hive (BK_evil) is in the game but was never on the Aliens' sidebar, so it has no
picture there.  It gets one in the manner of the others: the Aliens' evening sky and green
ground (taken from the edge of the Uplink's picture, where nothing stands in front of it)
behind the building itself, drawn from its own art.  (The Aliens' pizza shows the Astros'
picture: it is the same pizza.)
"""

import io
import json
import os

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

ICON_W, ICON_H = 50, 30
SKY_FROM = 4637          # the Uplink's (BH_evil) picture
SKY_COLUMN = 3           # a column of it with nothing in front of the sky
BORDER = 2               # the pictures' dark frame, kept as it is
HIVE_ART = 1557          # the Hive, built and at rest


def main():
    game = json.load(open(os.path.join(ROOT, 'data', 'game.json'), encoding='utf-8'))
    chars = game['chars']
    pack = open(os.path.join(ROOT, 'assets', 'game', 'bitmaps.bin'), 'rb').read()

    def image(bid):
        at, ln = chars[str(bid)]['pack']
        return Image.open(io.BytesIO(pack[at:at + ln])).convert('RGBA')

    sky = image(SKY_FROM)
    icon = sky.copy()
    for y in range(BORDER, ICON_H - BORDER):
        colour = sky.getpixel((SKY_COLUMN, y))
        for x in range(BORDER, ICON_W - BORDER):
            icon.putpixel((x, y), colour)

    hive = image(HIVE_ART)
    hive = hive.crop(hive.getbbox())
    width = ICON_W - 2 * BORDER - 2
    height = round(hive.height * width / hive.width)
    hive = hive.resize((width, height), Image.LANCZOS)
    inner = Image.new('RGBA', (ICON_W, ICON_H), (0, 0, 0, 0))
    inner.alpha_composite(hive, (BORDER + 1, ICON_H - BORDER - height - 1))
    # (Only inside the frame.)
    mask = Image.new('L', (ICON_W, ICON_H), 0)
    mask.paste(255, (BORDER, BORDER, ICON_W - BORDER, ICON_H - BORDER))
    icon.paste(inner, (0, 0), Image.composite(inner.getchannel('A'), mask, mask))

    out = os.path.join(ROOT, 'assets', 'online', 'icons')
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, 'BK_evil.png')
    icon.save(path)
    print(os.path.relpath(path, ROOT))


if __name__ == '__main__':
    main()
