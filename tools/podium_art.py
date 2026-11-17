"""Top-3 podium art generated with Codex (prompt: tools/codex_podium_prompt.txt) -> the files the home screen loads:
public/kit/podium_crown.webp, podium_medal2.webp, podium_medal3.webp (the pedestal steps were dropped)

  python -I tools/podium_art.py <dir with crown.png, medal_silver.png, medal_bronze.png> <public/kit>

A flat #00FF00 background (when the generator could not do transparency) is keyed out. Each piece is cropped to what
is drawn. A redrawn piece needs a new file name:
Verse8 keeps serving the old file under the old name.
"""
import os, sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]


def load(name):
    im = Image.open(os.path.join(src, name)).convert('RGBA')
    a = np.asarray(im).astype(np.int16)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    if (al < 250).mean() < 0.01:                                   # no transparency: key out the green
        green = (g > 150) & (g - np.maximum(r, b) > 70)
        alpha = np.where(green, 0, 255).astype(np.uint8)
        # soften the edge and pull the green spill out of the rim
        img = np.asarray(im).copy()
        spill = (g - np.maximum(r, b)) > 20
        img[..., 1] = np.where(spill & ~green, np.maximum(r, b), g).clip(0, 255).astype(np.uint8)
        img[..., 3] = alpha
        im = Image.fromarray(img)
    return im.crop(im.getbbox())


def save(im, name, width):
    h = round(im.height * width / im.width)
    im.resize((width, h), Image.LANCZOS).save(os.path.join(out, name), 'WEBP', quality=88, method=6)
    print(name, width, h, os.path.getsize(os.path.join(out, name)))


save(load('crown.png'), 'podium_crown.webp', 192)
save(load('medal_silver.png'), 'podium_medal2.webp', 112)
save(load('medal_bronze.png'), 'podium_medal3.webp', 112)
