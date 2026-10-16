"""The offline client's icon (client/icon.png): the Astro and the Alien, the main menu's figures
(assets/online), side by side and the same height, meeting in the middle -- neither in front of
the other -- on the Astro sidebar's orange; and the web app's
(assets/icons/, manifest.webmanifest): the same at 192 and 512 pixels, a full-bleed one for
Android to cut to its own shape ("maskable": the figures inside its middle two thirds), and an
opaque one for iPhones and iPads, which round its corners themselves; and the Android app's
(mobile/android/), if it is there: its launcher icons at each density (square, round, and the
foreground of the adaptive icon, on the orange of its background) and its splash screens, the
two figures on black."""
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
S = 1024


def tile():
    bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    grad = Image.new('RGBA', (S, S))
    px = grad.load()
    for y in range(S):
        t = y / (S - 1)
        r = int(255 * (1 - t) + 198 * t)
        g = int(193 * (1 - t) + 84 * t)
        b = int(90 * (1 - t) + 0 * t)
        for x in range(S):
            px[x, y] = (r, g, b, 255)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((40, 40, S - 40, S - 40), radius=190, fill=255)
    bg.paste(grad, (0, 0), mask)
    ring = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle((40, 40, S - 40, S - 40), radius=190, outline=(58, 58, 58, 255), width=26)
    bg.alpha_composite(ring)
    return bg, mask


def head(path, box, size, flip=False):
    im = Image.open(os.path.join(ROOT, path)).convert('RGBA').crop(box)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    k = size / max(im.width, im.height)
    return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)


def pair(width):
    """The two figures side by side, `width` pixels across all told: the Astro on the left and
    the Alien on the right, as tall as each other, a little apart and meeting in the middle, with
    their shadow."""
    gap = round(width * 0.02)
    astro = Image.open(os.path.join(ROOT, 'assets/online/astro.png')).convert('RGBA')
    alien = Image.open(os.path.join(ROOT, 'assets/online/alien.png')).convert('RGBA')
    astro = astro.crop(astro.getbbox())
    alien = alien.crop(alien.getbbox())
    # (one height for both, as much as fits the width)
    h = round((width - gap) / (astro.width / astro.height + alien.width / alien.height))
    astro = astro.resize((round(astro.width * h / astro.height), h), Image.LANCZOS)
    alien = alien.resize((round(alien.width * h / alien.height), h), Image.LANCZOS)
    pad = round(width * 0.04)
    layer = Image.new('RGBA', (astro.width + gap + alien.width + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    layer.alpha_composite(astro, (pad, pad))
    layer.alpha_composite(alien, (pad + astro.width + gap, pad))
    shadow = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    shadow.putalpha(layer.getchannel('A').filter(ImageFilter.GaussianBlur(width * 0.014)).point(lambda a: a * 0.6))
    out = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    out.alpha_composite(shadow, (round(width * 0.008), round(width * 0.014)))
    out.alpha_composite(layer)
    return out.crop(out.getbbox())


def figures(size):
    """The two figures, `size` pixels across at most (or as tall), on nothing."""
    both = pair(size)
    k = size / max(both.width, both.height)
    return both.resize((round(both.width * k), round(both.height * k)), Image.LANCZOS)


def orange():
    """The tile's orange, edge to edge."""
    grad = Image.new('RGBA', (S, S))
    px = grad.load()
    for y in range(S):
        t = y / (S - 1)
        c = (int(255 * (1 - t) + 198 * t), int(193 * (1 - t) + 84 * t), int(90 * (1 - t)), 255)
        for x in range(S):
            px[x, y] = c
    return grad


def full(inner):
    """The figures on orange, edge to edge, taking up `inner` of it."""
    out = orange()
    f = figures(round(S * inner))
    out.alpha_composite(f, ((S - f.width) // 2, (S - f.height) // 2))
    return out


def main():
    icon, mask = tile()
    both = figures(860)
    clip = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    clip.alpha_composite(both, ((S - both.width) // 2, (S - both.height) // 2 + 10))
    inside = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    inside.paste(clip, (0, 0), mask)
    icon.alpha_composite(inside)
    out = icon.resize((512, 512), Image.LANCZOS)
    path = os.path.join(ROOT, 'client', 'icon.png')
    out.save(path)
    print(path, out.size)
    icons = os.path.join(ROOT, 'assets', 'icons')
    os.makedirs(icons, exist_ok=True)
    for n in (192, 512):
        icon.resize((n, n), Image.LANCZOS).save(os.path.join(icons, 'icon-%d.png' % n))
    full(0.62).resize((512, 512), Image.LANCZOS).save(os.path.join(icons, 'icon-maskable-512.png'))
    full(0.9).convert('RGB').resize((180, 180), Image.LANCZOS).save(os.path.join(icons, 'apple-touch-icon.png'))
    print('assets/icons/')
    res = os.path.join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'res')
    if os.path.isdir(res):
        android(res, icon)
        print('mobile/android/app/src/main/res/')


DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def android(res, tile_icon):
    for name, k in DENSITIES.items():
        d = os.path.join(res, 'mipmap-' + name)
        n = round(48 * k)
        tile_icon.resize((n, n), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'))
        disc = full(0.8)
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, S, S), fill=255)
        r = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        r.paste(disc, (0, 0), mask)
        r.resize((n, n), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_round.png'))
        # (the adaptive icon's foreground: 108dp, of which the middle 66 always shows)
        f = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        fg = figures(round(S * 0.56))
        f.alpha_composite(fg, ((S - fg.width) // 2, (S - fg.height) // 2))
        m = round(108 * k)
        f.resize((m, m), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_foreground.png'))
    # the splash screens: the two figures on black
    for dirpath, _, names in os.walk(res):
        if 'splash.png' not in names or not os.path.basename(dirpath).startswith('drawable'):
            continue
        path = os.path.join(dirpath, 'splash.png')
        w, h = Image.open(path).size
        sp = Image.new('RGB', (w, h), (0, 0, 0))
        f = figures(round(min(w, h) * 0.6))
        sp.paste(f, ((w - f.width) // 2, (h - f.height) // 2), f)
        sp.save(path)


if __name__ == '__main__':
    main()
