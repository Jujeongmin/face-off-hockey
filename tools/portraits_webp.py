"""public/portraits/*.png (Blender renders, see tools/blender/render_portraits.py) -> *.webp for the game, 512x640.
  python -I tools/portraits_webp.py
"""
import os, sys
from PIL import Image
d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'portraits')
for f in sorted(os.listdir(d)):
    if not f.endswith('.png'): continue
    im = Image.open(os.path.join(d, f)).convert('RGBA')
    out = os.path.join(d, f[:-4] + '.webp')
    im.save(out, 'WEBP', quality=84, method=6)
    print(f, '->', os.path.basename(out), os.path.getsize(out))
