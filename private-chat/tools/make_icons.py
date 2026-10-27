"""生成应用图标：深色鱼缸底 + 蓝色胖鱼。使用 Pillow，仅开发时运行。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "app" / "web" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 圆角背景 + 垂直渐变
bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(bg)
for y in range(S):
    t = y / S
    r = int(8 + 2 * t)
    g = int(26 + 10 * t)
    b = int(38 + 16 * t)
    bd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S, S], radius=230, fill=255)
img.paste(bg, (0, 0), mask)

d = ImageDraw.Draw(img, "RGBA")

# 柔和光晕
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([80, 120, 820, 860], fill=(79, 157, 255, 55))
glow = glow.filter(ImageFilter.GaussianBlur(90))
img.alpha_composite(glow)

# 尾巴
tail = [(700, 520), (900, 380), (900, 660), (700, 545)]
d.polygon(tail, fill=(58, 130, 220, 255))
d.polygon([(720, 520), (870, 425), (870, 610), (720, 540)], fill=(79, 157, 255, 255))

# 身体
d.ellipse([150, 315, 750, 725], fill=(79, 157, 255, 255))
# 肚皮
d.ellipse([205, 500, 690, 715], fill=(97, 212, 212, 235))
# 背部高光
d.ellipse([235, 350, 640, 505], fill=(125, 186, 255, 120))

# 眼睛
d.ellipse([295, 425, 405, 535], fill=(255, 255, 255, 255))
d.ellipse([325, 455, 385, 515], fill=(7, 24, 35, 255))
d.ellipse([340, 468, 356, 484], fill=(255, 255, 255, 230))

# 腮红
d.ellipse([235, 540, 305, 585], fill=(255, 138, 92, 90))

# 嘴
d.arc([255, 540, 345, 615], start=15, end=75, fill=(10, 40, 60, 255), width=12)

# 鱼鳍
d.ellipse([430, 640, 610, 760], fill=(58, 130, 220, 255))

# 气泡
for cx, cy, r, a in [(800, 250, 34, 190), (865, 175, 22, 150), (890, 325, 15, 120)]:
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(150, 220, 255, a), width=8)

# 小星星
d.polygon([(820, 700), (832, 726), (860, 730), (838, 748), (844, 776), (820, 760),
           (796, 776), (802, 748), (780, 730), (808, 726)], fill=(255, 214, 102, 235))

img.save(OUT / "icon-1024.png")
for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png"), (64, "favicon.png")]:
    resized = img.resize((size, size), Image.LANCZOS)
    resized.save(OUT / name, optimize=True)
print("icons written to", OUT)
