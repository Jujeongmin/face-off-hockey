"""Stage star chests generated with Codex (prompt: tools/codex_chest_prompt.txt) -> public/kit/chest_<metal>[_open].webp
(bronze at 10 stars, silver at 20, gold at 30; open = already claimed).

  python -I tools/chest_art.py <dir with chest_bronze.png ... chest_gold_open.png> <public/kit>

A flat #00FF00 background is keyed out. Closed and open of one metal are cropped to their common box so the chest
does not jump when it opens. A redrawn chest needs a new file name: Verse8 keeps serving the old file under the old name.
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


for metal in ('bronze', 'silver', 'gold'):
    shut, open_ = load(f'chest_{metal}.png'), load(f'chest_{metal}_open.png')
    a, b = shut.getbbox(), open_.getbbox()
    box = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
    for im, name in ((shut, f'chest_{metal}.webp'), (open_, f'chest_{metal}_open.webp')):
        im = im.crop(box)
        w = 128
        im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(os.path.join(out, name), 'WEBP', quality=88, method=6)
        print(name, os.path.getsize(os.path.join(out, name)))
