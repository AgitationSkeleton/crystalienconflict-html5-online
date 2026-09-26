"""The offline client's icon (client/icon.png): the Engineer and the Saboteur, face to face, the
main menu's figures (assets/online), on the Astro sidebar's orange."""
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


def main():
    icon, mask = tile()
    astro = head('assets/online/astro.png', (0, 0, 535, 512), 600)
    alien = head('assets/online/alien.png', (0, 0, 405, 512), 600)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    y = (S - astro.height) // 2 + 30
    layer.alpha_composite(alien, (S - alien.width - 70, y))
    layer.alpha_composite(astro, (60, y))
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shadow.putalpha(layer.getchannel('A').filter(ImageFilter.GaussianBlur(14)).point(lambda a: a * 0.6))
    clip = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    clip.alpha_composite(shadow, (8, 14))
    clip.alpha_composite(layer)
    inside = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    inside.paste(clip, (0, 0), mask)
    icon.alpha_composite(inside)
    out = icon.resize((512, 512), Image.LANCZOS)
    path = os.path.join(ROOT, 'client', 'icon.png')
    out.save(path)
    print(path, out.size)


if __name__ == '__main__':
    main()
