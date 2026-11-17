"""Dane (bg4) shares Viktor's texture atlas: recolour the charcoal suit camel so the two read as different players.
Writes art-src/bg4_D.png, which tools/blender/retarget.py bg4 uses as the base colour.

  python -I tools/dane_suit.py <Boduguard_01_D.tga>
"""
import os, sys
import numpy as np
from PIL import Image

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'art-src', 'bg4_D.png')
a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
hi, lo = a.max(2), a.min(2)
sat = (hi - lo) / np.maximum(hi, 1e-4)
# the suit is dark and almost grey; the tie, belt and sunglasses are darker still and stay black, the shirt and skin are brighter or coloured
cloth = (sat < 0.16) & (hi > 0.09) & (hi < 0.62)
# eyes and teeth sit in this corner of the atlas (fractions of its size) and are grey too
h, w = hi.shape
cloth[int(h * 0.07):int(h * 0.22), int(w * 0.84):int(w * 0.995)] = False
camel = np.array([0.66, 0.50, 0.31], dtype=np.float32)
shade = (a.mean(2) / 0.2).clip(0.35, 2.0)[..., None]                 # keeps the weave and folds
b = a.copy()
b[cloth] = (camel * shade)[cloth].clip(0, 1)
Image.fromarray((b * 255).astype(np.uint8)).save(out)
print('wrote', out, f'{cloth.mean():.1%} of the atlas')
