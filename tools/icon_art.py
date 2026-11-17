"""Interface icons generated with Codex (prompt: tools/codex_icons_prompt.txt) -> public/kit/ic_<name>.webp:
star_on / star_off (stage and result stars), padlock (locked stage), arrow (enhance steps, menu rows), phone (the
turn-your-phone screen). The ad button uses the wallet's coin (v4_coin.webp), so coin.png is not converted.

  python -I tools/icon_art.py <dir with star_on.png, star_off.png, padlock.png, arrow.png, phone.png> <public/kit>

A flat #00FF00 background is keyed out. star_on and star_off share one crop box so they swap without moving.
A redrawn icon needs a new file name: Verse8 keeps serving the old file under the old name.
"""
import os, sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]


def load(name):
    im = Image.open(os.path.join(src, name)).convert('RGBA')
    a = np.asarray(im).astype(np.int16)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    if (al < 250).mean() < 0.01:                                   # no transparency: key out the green, pull spill off the rim
        green = (g > 150) & (g - np.maximum(r, b) > 70)
        img = np.asarray(im).copy()
        spill = (g - np.maximum(r, b)) > 20
        img[..., 1] = np.where(spill & ~green, np.maximum(r, b), g).clip(0, 255).astype(np.uint8)
        img[..., 3] = np.where(green, 0, 255).astype(np.uint8)
        im = Image.fromarray(img)
    return im


def save(im, name, width):
    im.resize((width, round(im.height * width / im.width)), Image.LANCZOS).save(os.path.join(out, name), 'WEBP', quality=90, method=6)
    print(name, os.path.getsize(os.path.join(out, name)))


on, off = load('star_on.png'), load('star_off.png')
a, b = on.getbbox(), off.getbbox()
box = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
save(on.crop(box), 'ic_star_on.webp', 96)
save(off.crop(box), 'ic_star_off.webp', 96)
for name, w in (('padlock', 64), ('arrow', 64), ('phone', 160)):
    im = load(f'{name}.png')
    save(im.crop(im.getbbox()), f'ic_{name}.webp', w)
