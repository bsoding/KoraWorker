"""Draw the Kora face as the Windows application icon."""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
OUT.mkdir(exist_ok=True)
SIZE = 1024

base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(shadow)
draw.rounded_rectangle((104, 113, 920, 929), radius=242, fill=(121, 68, 95, 100))
base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(34)))

gradient = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
pixels = gradient.load()
for y in range(SIZE):
    for x in range(SIZE):
        t = min(1, max(0, (x * 0.18 + y * 0.82) / SIZE))
        pixels[x, y] = (int(255 - 12*t), int(202 - 72*t), int(157 - 27*t), 255)
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle((99, 87, 925, 913), radius=240, fill=255)
base.paste(gradient, (0, 0), mask)

shine = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ImageDraw.Draw(shine).ellipse((-160, -300, 620, 460), fill=(255, 245, 213, 100))
shine = shine.filter(ImageFilter.GaussianBlur(90))
shine.putalpha(ImageChops.multiply(shine.getchannel("A"), mask))
base.alpha_composite(shine)

face = ImageDraw.Draw(base)
ink = (94, 57, 73, 255)
face.ellipse((317, 408, 376, 467), fill=ink)
face.ellipse((645, 408, 704, 467), fill=ink)
face.arc((380, 460, 638, 665), start=10, end=170, fill=ink, width=30)

png = base.resize((256, 256), Image.Resampling.LANCZOS)
png.save(OUT / "kora.png")
base.save(OUT / "kora.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(OUT / "kora.ico")
