"""Demo music for the store's screenshots: public-domain works (the composer as artist), abstract covers drawn here and
soft synthetic audio (no recording of anyone's). Writes <out>/<artist>/<album>/NN title.mp3 with tags and cover.
  python make_demo.py <out dir>          (needs Pillow and ffmpeg)"""
import math
import random
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(sys.argv[1])
ALBUMS = [
    ('Johann Sebastian Bach', 'Suites para violonchelo', 1720, ['#2b4c7e', '#e0b25c'], 'circles',
     ['Suite n.º 1: Preludio', 'Suite n.º 1: Allemande', 'Suite n.º 1: Courante', 'Suite n.º 1: Sarabande',
      'Suite n.º 1: Minueto', 'Suite n.º 1: Giga', 'Suite n.º 3: Preludio', 'Suite n.º 3: Bourrée']),
    ('Frédéric Chopin', 'Nocturnos', 1832, ['#1d1b3a', '#c86b98'], 'waves',
     ['Nocturno op. 9 n.º 1', 'Nocturno op. 9 n.º 2', 'Nocturno op. 9 n.º 3', 'Nocturno op. 27 n.º 2',
      'Nocturno op. 48 n.º 1', 'Nocturno op. 72 n.º 1', 'Nocturno en do sostenido menor']),
    ('Claude Debussy', 'Suite bergamasque', 1905, ['#0f3b46', '#8fd3c1'], 'moon',
     ['Prélude', 'Menuet', 'Clair de lune', 'Passepied']),
    ('Erik Satie', 'Gymnopédies y Gnossiennes', 1888, ['#f1e7d6', '#d1553b'], 'bars',
     ['Gymnopédie n.º 1', 'Gymnopédie n.º 2', 'Gymnopédie n.º 3', 'Gnossienne n.º 1', 'Gnossienne n.º 2',
      'Gnossienne n.º 3']),
    ('Antonio Vivaldi', 'Las cuatro estaciones', 1725, ['#5a8f29', '#f4d35e'], 'leaves',
     ['La primavera: Allegro', 'La primavera: Largo', 'La primavera: Allegro pastorale', 'El verano: Presto',
      'El otoño: Allegro', 'El invierno: Largo', 'El invierno: Allegro']),
    ('Wolfgang Amadeus Mozart', 'Pequeña serenata nocturna', 1787, ['#7a1f2b', '#f2c6a0'], 'stripes',
     ['Allegro', 'Romanza: Andante', 'Minueto: Allegretto', 'Rondó: Allegro', 'Rondó alla turca']),
    ('Piotr Ilich Chaikovski', 'El cascanueces', 1892, ['#3b1f5c', '#ffcf6e'], 'stars',
     ['Obertura miniatura', 'Marcha', 'Danza del hada de azúcar', 'Trepak', 'Danza árabe', 'Danza china',
      'Vals de las flores']),
    ('Ludwig van Beethoven', 'Sonatas para piano', 1801, ['#222222', '#e8e2d0'], 'grid',
     ['Claro de luna: Adagio sostenuto', 'Claro de luna: Allegretto', 'Claro de luna: Presto agitato',
      'Patética: Adagio cantabile', 'Para Elisa']),
]


def rgb(h):
    return tuple(int(h.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))


def cover(style, colors, seed):
    rnd = random.Random(seed)
    N = 1200
    a, b = rgb(colors[0]), rgb(colors[1])
    img = Image.new('RGB', (N, N), a)
    d = ImageDraw.Draw(img, 'RGBA')

    def mix(t, al=255):
        return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (al,)

    if style == 'circles':
        for k in range(9, 0, -1):
            r = k * 64
            d.ellipse([N * .5 - r, N * .55 - r, N * .5 + r, N * .55 + r], outline=mix(k / 9, 230), width=18)
    elif style == 'waves':
        for k in range(14):
            pts = [(x, N * .25 + k * 52 + 60 * math.sin(x / 140 + k * .5)) for x in range(0, N + 20, 20)]
            d.line(pts, fill=mix(k / 14, 200), width=14)
    elif style == 'moon':
        d.ellipse([360, 220, 840, 700], fill=mix(1))
        d.ellipse([460, 180, 940, 660], fill=a + (255,))
        for _ in range(40):
            x, y = rnd.randrange(N), rnd.randrange(N)
            d.ellipse([x, y, x + 6, y + 6], fill=mix(1, 180))
        for k in range(6):
            d.line([(0, 860 + k * 50), (N, 860 + k * 50)], fill=mix(.6 + k * .06, 120), width=8)
    elif style == 'bars':
        x = 120
        while x < N - 120:
            w = rnd.choice([30, 60, 110])
            h = rnd.randrange(200, 900)
            d.rectangle([x, N - 120 - h, x + w, N - 120], fill=mix(rnd.random() * .5 + .5, 235))
            x += w + 40
    elif style == 'leaves':
        for _ in range(26):
            x, y, r = rnd.randrange(N), rnd.randrange(N), rnd.randrange(60, 180)
            d.ellipse([x - r, y - r * .5, x + r, y + r * .5], fill=mix(rnd.random(), 170))
    elif style == 'stripes':
        for k in range(-N, N, 90):
            d.polygon([(k, 0), (k + 45, 0), (k + 45 + N, N), (k + N, N)], fill=mix(.9, 140))
        d.ellipse([350, 350, 850, 850], fill=mix(1))
    elif style == 'stars':
        for _ in range(60):
            x, y, r = rnd.randrange(N), rnd.randrange(N), rnd.randrange(6, 30)
            pts = [(x + (r if i % 2 == 0 else r * .4) * math.cos(math.pi * i / 5),
                    y + (r if i % 2 == 0 else r * .4) * math.sin(math.pi * i / 5)) for i in range(10)]
            d.polygon(pts, fill=mix(rnd.random() * .4 + .6, 230))
    elif style == 'grid':
        for i in range(8):
            for j in range(8):
                if rnd.random() < .45:
                    d.rectangle([100 + i * 125, 100 + j * 125, 200 + i * 125, 200 + j * 125],
                                fill=mix(rnd.random() * .5 + .5))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    return img.resize((800, 800), Image.LANCZOS)


for ai, (artist, album, year, colors, style, tracks) in enumerate(ALBUMS):
    folder = OUT / artist / album
    folder.mkdir(parents=True, exist_ok=True)
    art = folder / 'cover.jpg'
    cover(style, colors, ai).save(art, quality=90)
    for ti, title in enumerate(tracks, 1):
        mp3 = folder / f'{ti:02d} {title.replace(":", " -")}.mp3'
        if mp3.exists():
            continue
        secs = 150 + (ai * 37 + ti * 53) % 230
        f = 196 * 2 ** (((ai * 3 + ti * 5) % 12) / 12)
        expr = (f'0.18*sin(2*PI*{f:.2f}*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.10*sin(2*PI*{f * 1.5:.2f}*t)'
                f'+0.07*sin(2*PI*{f * 2:.2f}*t)*(0.5+0.5*sin(2*PI*0.5*t))')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'aevalsrc={expr}:s=22050:d={secs}',
                        '-i', str(art), '-map', '0', '-map', '1', '-c:a', 'libmp3lame', '-b:a', '32k', '-ac', '1',
                        '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', '-id3v2_version', '3',
                        '-metadata', f'title={title}', '-metadata', f'artist={artist}',
                        '-metadata', f'album_artist={artist}', '-metadata', f'album={album}',
                        '-metadata', f'track={ti}/{len(tracks)}', '-metadata', f'date={year}',
                        '-metadata', 'genre=Clásica', str(mp3)], check=True)
    print(artist, '·', album)
