"""
Pictures of the skirmish maps, as the game draws them, for reviewing the converted maps.

    python tools/render_maps.py [ID ...]      -> work/map-renders/<id>.png, index.html, contact-sheet.png

Each map is played as a skirmish (shroud off, Mars palette) with a headquarters on each base
marker, in the players' colours in slot order (orange, green, red, blue, purple, cyan), and
drawn whole: the view is zoomed out past what a player may, the sidebar hidden, and the
picture cut to the map.  The name, id and size are written on the picture.  With no ids, every
map in data/maps/index.json is drawn, and then a contact sheet of them all.
"""

import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DRIVE = os.path.join(ROOT, 'tools', 'verify', 'drive.py')
OUT = os.path.join(ROOT, 'work', 'map-renders')
VIEW_W, VIEW_H = 2700, 1200            # CSS pixels: a 900x400 stage, three pixels a unit
SCALE = VIEW_H / 400
COLOURS = ['orange', 'green', 'red', 'blue', 'purple', 'cyan']

BATCH = 16                              # maps to a browser (the command line has a limit)

# Shown whole: the view zoomed to the map, the sidebar and the page's menus out of the way.
SHOW = '''window.__show = ((id) => {
  const root = player.levels[1];
  const lv = root.panel.game.level, a = lv.arena;
  const stage = document.getElementById('stage');
  document.querySelectorAll('body *').forEach((e) => { if (e !== stage && !e.contains(stage)) e.style.visibility = 'hidden'; });
  if (root.panel.game.hud && root.panel.game.hud.MC) root.panel.game.hud.MC._visible = false;
  const W = root.SCREENX - 150, H = root.SCREENY;
  const zoom = Math.min(W / a.width, H / a.height);
  a.fitView = function () {
    this.zoom = zoom; this.viewWidthPx = W; this.viewHeightPx = H;
    this.viewWidth = W / zoom; this.viewHeight = H / zoom;
    this.viewWidth2 = this.viewWidth / 2; this.viewHeight2 = this.viewHeight / 2;
    this.mask._width = W; this.mask._height = H;
    this.MC._xscale = this.MC._yscale = zoom * 100;
    this.snap = true;
  };
  a.fitView();
  lv.camera.posX = 0; lv.camera.posY = 0;
  return { id, w: a.width * zoom, h: a.height * zoom, cols: a.cols, rows: a.rows, errors: [...player.errors.keys()] };
}), true'''


def settings(m):
    players = [{'name': 'P%d' % (i + 1), 'faction': 'good' if i % 2 == 0 else 'evil', 'colour': COLOURS[i],
                'control': 'local' if i == 0 else 'idle'} for i in range(min(6, max(2, m['players'])))]
    return {'map': m['id'], 'mode': 'all', 'cash': 10000, 'units': 0, 'prebuilt': False, 'shroud': False,
            'superweapons': False, 'palette': 'mars', 'specops': 'on', 'players': players}


def label(im, text):
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('arialbd.ttf', 28)
    except OSError:
        font = ImageFont.load_default()
    box = d.textbbox((0, 0), text, font=font)
    d.rectangle((8, 8, 24 + box[2] - box[0], 24 + box[3] - box[1]), fill=(0, 0, 0))
    d.text((16, 14 - box[1]), text, fill=(255, 255, 255), font=font)


def write_index(index):
    """A page of every picture there is, for looking through them in a browser."""
    rows = []
    for m in index:
        if os.path.isfile(os.path.join(OUT, m['id'] + '.png')):
            rows.append('<figure><a href="%s.png"><img loading="lazy" src="%s.png" alt=""></a><figcaption>%s &mdash; %s, %dx%d, %d bases</figcaption></figure>'
                        % (m['id'], m['id'], m['name'], m['id'], m['cols'], m['rows'], m['players']))
    page = ('<!doctype html><meta charset="utf-8"><title>Skirmish maps</title>'
            '<style>body{background:#181818;color:#ddd;font:14px sans-serif;margin:16px}'
            'figure{margin:0 0 24px}img{max-width:100%%;border:1px solid #333}</style>'
            '<h1>Skirmish maps (%d)</h1>%s' % (len(rows), ''.join(rows)))
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as fh:
        fh.write(page)


def main():
    index = json.load(open(os.path.join(ROOT, 'data', 'maps', 'index.json'), encoding='utf-8'))
    wanted = sys.argv[1:]
    maps = [m for m in index if not wanted or m['id'] in wanted]
    os.makedirs(OUT, exist_ok=True)
    shots = os.path.join(OUT, 'shots')
    sizes = {}
    for at in range(0, len(maps), BATCH):
        acts = ['boot', 'step 70', 'move 20 200', 'eval ' + SHOW]
        for m in maps[at:at + BATCH]:
            acts += ['eval player.levels[1].panel.gameOver("quit")', 'step 5',
                     'eval player.levels[1].panel.startSkirmish(%s)' % json.dumps(settings(m), separators=(',', ':')), 'step 40',
                     'eval __show(%s)' % json.dumps(m['id']), 'step 3', 'shot ' + m['id']]
        r = subprocess.run([sys.executable, DRIVE, shots, '--test', '--viewport', '%dx%d' % (VIEW_W, VIEW_H)] + acts,
                           capture_output=True, text=True, cwd=ROOT)
        for line in r.stdout.splitlines():
            if line.startswith('eval: {'):
                v = json.loads(line[6:])
                sizes[v['id']] = v
                if v['errors']:
                    print(v['id'], 'script errors', v['errors'])
        if r.returncode:
            print(r.stderr[-2000:])
    done = []
    for m in maps:
        v = sizes.get(m['id'])
        path = os.path.join(shots, m['id'] + '.png')
        if not v or not os.path.isfile(path):
            print(m['id'], 'not drawn')
            continue
        shot = Image.open(path).convert('RGB')
        pic = shot.crop((round(150 * SCALE), 0, round((150 + v['w']) * SCALE), round(v['h'] * SCALE)))
        label(pic, '%s  (%s, %dx%d, %d bases)' % (m['name'], m['id'], m['cols'], m['rows'], m['players']))
        pic.save(os.path.join(OUT, m['id'] + '.png'))
        done.append((m, pic))
        print(m['id'], pic.size)
    if done:
        write_index(index)
    if not wanted and done:
        cols = 4
        tw, th = 600, 300
        sheet = Image.new('RGB', (cols * (tw + 10) + 10, ((len(done) + cols - 1) // cols) * (th + 10) + 10), (20, 20, 20))
        for i, (m, pic) in enumerate(done):
            t = pic.copy()
            t.thumbnail((tw, th), Image.LANCZOS)
            sheet.paste(t, (10 + (i % cols) * (tw + 10), 10 + (i // cols) * (th + 10)))
        sheet.save(os.path.join(OUT, 'contact-sheet.png'))
        print('contact sheet: %d maps' % len(done))


if __name__ == '__main__':
    main()
