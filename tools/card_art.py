"""Card frames generated with Codex (prompt: tools/codex_cards_prompt.txt) -> the two layers the game draws, the portrait goes between them:
public/kit/card<g>_b.webp  the whole card
public/kit/card<g>_f.webp  only what stands in front of the player: the rim, the rating socket and the name plate

  python -I tools/card_art.py <dir with card0.png .. card4.png> <public/kit>
A redrawn frame needs new file names: Verse8 keeps serving the old file under the old name.
"""
import math, os, sys
from PIL import Image, ImageDraw, ImageFilter

src, out = sys.argv[1], sys.argv[2]
W, H = 512, 768
SS = 2                                                                  # the mask is drawn large, then scaled down for a clean edge
for g in range(5):
    card = Image.open(os.path.join(src, f'card{g}.png')).convert('RGBA').resize((W, H), Image.LANCZOS)
    card.save(os.path.join(out, f'card{g}_b.webp'), 'WEBP', quality=86, method=6)
    mask = Image.new('L', (W * SS, H * SS), 0)
    d = ImageDraw.Draw(mask)
    w, h = W * SS, H * SS
    d.rectangle([0, 0, w * 0.058, h], fill=255)                         # the rim down each side
    d.rectangle([w * 0.942, 0, w, h], fill=255)
    d.rectangle([0, 0, w, h * 0.052], fill=255)                         # along the top
    d.rectangle([0, h * 0.722, w, h], fill=255)                         # the name plate and everything below it
    cx, cy, r = w * 0.209, h * 0.181, w * 0.158
    d.polygon([(cx + r * math.cos(math.radians(90 + 60 * i)), cy + r * 1.0 * math.sin(math.radians(90 + 60 * i))) for i in range(6)], fill=255)   # the rating socket
    mask = mask.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.7))
    alpha = card.getchannel('A')
    front = card.copy()
    front.putalpha(Image.composite(alpha, Image.new('L', (W, H), 0), mask))
    front.save(os.path.join(out, f'card{g}_f.webp'), 'WEBP', quality=86, method=6)
    print('card', g)
