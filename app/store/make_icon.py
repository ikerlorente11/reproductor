"""El Reproductor's icon: the white note on green, as on the desktop app, drawn at 4x and scaled down.
  python make_icon.py <assets dir> <store dir>
Writes the app's icon, adaptive foreground and splash, and the Play Store's 512 px icon and source."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

S = 4
N = 1024 * S
OUT = Path(sys.argv[1])
PLAY = Path(sys.argv[2])
GREEN = (31, 184, 102)       # #1fb866, the adaptive icon's background
GREEN_TOP = (40, 200, 116)
WHITE = (255, 255, 255, 255)


def note(scale=1.0):
    """The note on transparent, centred; scale 1 is the desktop icon's size."""
    layer = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    u = N / 1024 * scale
    # the desktop design's box is ~250..765 x 220..760: centre it
    ox = N / 2 - 507 * u
    oy = N / 2 - 490 * u

    def P(x, y):
        return (ox + x * u, oy + y * u)

    d.polygon([P(410, 280), P(762, 220), P(762, 330), P(410, 392)], fill=WHITE)   # the beam
    d.rectangle([P(410, 280), P(451, 690)], fill=WHITE)                          # left stem
    d.rectangle([P(720, 230), P(762, 625)], fill=WHITE)                          # right stem
    for cx, cy in ((350, 680), (660, 620)):                                       # the heads
        d.ellipse([P(cx - 100, cy - 80), P(cx + 100, cy + 80)], fill=WHITE)
    return layer


def background():
    g = Image.new('RGB', (1, 256))
    for y in range(256):
        t = y / 255
        g.putpixel((0, y), tuple(int(GREEN_TOP[i] + (GREEN[i] - GREEN_TOP[i]) * t) for i in range(3)))
    return g.resize((N, N), Image.BICUBIC).convert('RGBA')


def down(img, size):
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
PLAY.mkdir(parents=True, exist_ok=True)
full = background()
full.alpha_composite(note(0.92))
down(full, 1024).save(OUT / 'icon.png')
down(full, 1024).convert('RGB').save(PLAY / 'icono-fuente.png')
down(full, 512).convert('RGB').save(PLAY / 'icono-512.png')
down(note(0.84), 1024).save(OUT / 'adaptive-icon.png')       # inside the adaptive icon's safe zone
splash = Image.new('RGBA', (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(splash)
r = N * 0.46
d.rounded_rectangle([N / 2 - r, N / 2 - r, N / 2 + r, N / 2 + r], radius=r * 0.45, fill=GREEN + (255,))
splash.alpha_composite(note(0.8))
down(splash, 1024).save(OUT / 'splash-icon.png')
print('ok')
