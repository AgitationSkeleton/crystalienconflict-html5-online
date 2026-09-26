"""
The main menu's two figures: the Engineer and the Saboteur running, from the cutscenes of the
levels that teach repairing (the Astros' level 3, "build and repair", and the Aliens' level 15).

    python tools/make_menu_figures.py      -> assets/online/astro.png, alien.png

Each is a symbol of the game movie, drawn by the port itself (tools/verify/drive.py) on its own,
once on white and once on black: the difference gives the transparency, so the edges come out
clean on any background.  Then 512 pixels tall, in 256 colours.
"""

import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DRIVE = os.path.join(ROOT, 'tools', 'verify', 'drive.py')
HEIGHT = 512

# name: (character id, frame, scale in per cent -- large, but inside the 600x400 stage)
FIGURES = {
    'astro': (322, 1, 110),       # the Engineer, with his toolbox (level 3's cutscene)
    'alien': (635, 1, 56),        # the Saboteur, with a Sonar dish (level 15's)
}

SETUP = '''(() => {
  const stage = document.getElementById('stage');
  document.querySelectorAll('body *').forEach((e) => { if (e !== stage && !e.contains(stage)) e.style.visibility = 'hidden'; });
  const root = player.levels[1];
  if (root.panel && root.panel.MC) root.panel.MC._visible = false;
  window.__bg = (rgb) => {
    if (root.figureBg) root.figureBg.removeMovieClip();
    const bg = player.attach(root, root.$lib, null, 'figureBg', 99990, null);
    bg.beginFill(rgb, 100);
    bg.moveTo(-4000, -4000); bg.lineTo(8000, -4000); bg.lineTo(8000, 8000); bg.lineTo(-4000, 8000); bg.lineTo(-4000, -4000);
    bg.endFill();
    return true;
  };
  window.__fig = (id, frame, scale) => {
    if (root.figure) root.figure.removeMovieClip();
    const f = player.attach(root, root.$lib, id, 'figure', 99991, null);
    f.gotoAndStop(frame);
    f._xscale = f._yscale = scale;
    const b = f.getBounds(root);
    f._x += 300 - (b.xMin + b.xMax) / 2;
    f._y += 200 - (b.yMin + b.yMax) / 2;
    return true;
  };
  return true;
})()'''


def unmatte(white, black):
    """The picture, with its transparency, from its renderings on white and on black."""
    r, g, b = ImageChops.subtract(white, black).split()
    alpha = Image.eval(ImageChops.lighter(ImageChops.lighter(r, g), b), lambda v: 255 - v)
    out = Image.new('RGBA', black.size)
    src, a, dst = black.load(), alpha.load(), out.load()
    for y in range(black.size[1]):
        for x in range(black.size[0]):
            al = a[x, y]
            if al:
                dst[x, y] = tuple(min(255, round(c * 255 / al)) for c in src[x, y]) + (al,)
    return out.crop(out.getbbox())


def main():
    work = tempfile.mkdtemp(prefix='figures-')
    acts = ['boot', 'step 70', 'eval ' + SETUP]
    for name, (cid, frame, scale) in FIGURES.items():
        acts += ['eval __fig(%d, %d, %d)' % (cid, frame, scale),
                 'eval __bg(0xffffff)', 'step 1', 'shot %s_white' % name,
                 'eval __bg(0x000000)', 'step 1', 'shot %s_black' % name]
    subprocess.run([sys.executable, DRIVE, work, '--test', '--dpr', '2'] + acts, check=True, cwd=ROOT)
    for name in FIGURES:
        white = Image.open(os.path.join(work, name + '_white.png')).convert('RGB')
        black = Image.open(os.path.join(work, name + '_black.png')).convert('RGB')
        fig = unmatte(white, black)
        fig = fig.resize((round(fig.width * HEIGHT / fig.height), HEIGHT), Image.LANCZOS)
        fig = fig.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
        path = os.path.join(ROOT, 'assets', 'online', name + '.png')
        fig.save(path, optimize=True)
        print(os.path.relpath(path, ROOT), fig.size)


if __name__ == '__main__':
    main()
