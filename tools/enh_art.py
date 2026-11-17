"""Upgrade badges generated with Codex (prompt: tools/codex_enhance_prompt.txt) -> public/kit/enh_bronze.webp, enh_silver.webp,
enh_gold.webp (bronze from +3, silver from +6, gold from +9).

  python -I tools/enh_art.py <dir with enh_bronze.png, enh_silver.png, enh_gold.png> <public/kit>

A flat #00FF00 background is keyed out, each badge cropped to what is drawn. A redrawn badge needs a new file name:
Verse8 keeps serving the old file under the old name.
"""
import os, sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]

for k in ('bronze', 'silver', 'gold'):
    im = Image.open(os.path.join(src, f'enh_{k}.png')).convert('RGBA')
    a = np.asarray(im).astype(np.int16)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    if (al < 250).mean() < 0.01:                                   # no transparency: key out the green, pull spill off the rim
        green = (g > 150) & (g - np.maximum(r, b) > 70)
        img = np.asarray(im).copy()
        spill = (g - np.maximum(r, b)) > 20
        img[..., 1] = np.where(spill & ~green, np.maximum(r, b), g).clip(0, 255).astype(np.uint8)
        img[..., 3] = np.where(green, 0, 255).astype(np.uint8)
        im = Image.fromarray(img)
    im = im.crop(im.getbbox())
    w = 96
    name = f'enh_{k}.webp'
    im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(os.path.join(out, name), 'WEBP', quality=88, method=6)
    print(name, os.path.getsize(os.path.join(out, name)))
