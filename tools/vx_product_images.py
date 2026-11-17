"""VXShop product images, 512 x 512: the scenes from tools/blender/render_vx_products.py with a little bloom, a vignette and the amount.

  blender -b --factory-startup --python tools/blender/render_vx_products.py -- <render dir>
  python -I tools/vx_product_images.py <render dir> <out dir>
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

renders, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
SIZE = 512
FONT = 'C:/Windows/Fonts/impact.ttf'
# gems, render, bonus over the base rate of 1 gem per VX
PACKS = ((100, 1, 0), (550, 2, 10), (1200, 3, 20), (3900, 4, 30), (7000, 5, 40), (15000, 6, 50))


def finish(path):
    img = Image.open(path).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32) / 255
    # bloom: only what is close to white spills over
    bright = np.clip(a - 0.86, 0, 1) * 4.0
    glow = np.asarray(Image.fromarray((bright * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255
    a = np.clip(a + glow * 0.42, 0, 1)
    # vignette, and the foot of the image falling away to dark for the amount
    y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32) / (SIZE - 1)
    edge = 1 - 0.55 * np.clip(np.hypot(x - 0.5, (y - 0.46) * 1.05) / 0.72, 0, 1) ** 2.4
    foot = 1 - 0.92 * np.clip((y - 0.72) / 0.2, 0, 1) ** 1.3
    a = a * (edge * foot)[..., None]
    return Image.fromarray((a * 255).astype(np.uint8))


for gems, tier, bonus in PACKS:
    img = finish(os.path.join(renders, f'tier{tier}.png'))
    d = ImageDraw.Draw(img)
    text = f'{gems:,}'
    font = ImageFont.truetype(FONT, 84)
    w = d.textlength(text, font=font)
    d.text(((SIZE - w) / 2, 406), text, font=font, fill=(244, 248, 255), stroke_width=3, stroke_fill=(5, 18, 35))
    if bonus:
        tag = f'+{bonus}%'
        small = ImageFont.truetype(FONT, 44)
        tw = d.textlength(tag, font=small)
        d.polygon([(SIZE - tw - 50, 16), (SIZE - 12, 16), (SIZE - 24, 76), (SIZE - tw - 62, 76)], fill=(255, 196, 46))
        d.text((SIZE - tw - 36, 19), tag, font=small, fill=(5, 18, 35))
    img.save(os.path.join(out, f'gems_{gems}.png'), optimize=True)
    print('gems', gems)
