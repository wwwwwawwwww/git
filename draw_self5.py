# -*- coding: utf-8 -*-
"""本鱼自画像 v5 —— 蓝色大肥鱼（DeepSeek 鲸鱼娘 mascot）。"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont

S = 2048
OUT = 1024
FONT_B = "C:/Windows/Fonts/msyhbd.ttc"

NAVY = (23, 34, 68, 255)
WHITE = (252, 253, 255)
PAPER = (255, 253, 247)


def lerp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def vgrad3(c1, c2, c3, stops=(0.0, 0.55, 1.0), size=S):
    arr = np.zeros((size, size, 3), np.uint8)
    for i, t in enumerate(np.linspace(0, 1, size)):
        c = lerp(c1, c2, (t - stops[0]) / (stops[1] - stops[0])) if t <= stops[1] \
            else lerp(c2, c3, (t - stops[1]) / (stops[2] - stops[1]))
        arr[i, :, :] = c
    return Image.fromarray(arr, "RGB")


def radial(cx, cy, r, power=1.6, peak=255):
    y, x = np.mgrid[0:S, 0:S]
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
    return Image.fromarray((np.clip(1 - d, 0, 1) ** power * peak).astype(np.uint8), "L")


def catmull(pts, n=28, closed=True):
    P = list(pts)
    P = ([P[-1]] + P + [P[0], P[1]]) if closed else ([P[0]] + P + [P[-1]])
    out = []
    for i in range(len(P) - 3):
        p0, p1, p2, p3 = [np.array(p, float) for p in P[i:i + 4]]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t +
                       (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                       (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append((float(q[0]), float(q[1])))
    return out


seg = lambda pts: [(int(round(x)), int(round(y))) for x, y in pts]


def ell_pts(cx, cy, rx, ry, ang=0.0, n=160):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    u, v = rx * np.cos(t), ry * np.sin(t)
    ca, sa = np.cos(ang), np.sin(ang)
    return [(cx + a * ca - b * sa, cy + a * sa + b * ca) for a, b in zip(u, v)]


def mask_of(fn):
    m = Image.new("L", (S, S), 0)
    fn(ImageDraw.Draw(m))
    return m


def erode(mask, px):
    m = mask
    for _ in range(int(px)):
        m = m.filter(ImageFilter.MinFilter(3))
    return m


def add_outline(layer, mask, color=NAVY, ow=13, blur=1.2):
    edge = ImageChops.subtract(mask, erode(mask, ow))
    if blur:
        edge = edge.filter(ImageFilter.GaussianBlur(blur))
    o = Image.new("RGBA", (S, S), color)
    o.putalpha(edge)
    layer.alpha_composite(o)


def paint(layer, mask, fill, outline=None, ow=13, soft=0):
    m = mask.filter(ImageFilter.GaussianBlur(soft)) if soft else mask
    if isinstance(fill, Image.Image):
        tmp = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        tmp.paste(fill.convert("RGB"), (0, 0), m)
    else:
        tmp = Image.new("RGBA", (S, S), fill)
        tmp.putalpha(m)
    layer.alpha_composite(tmp)
    if outline:
        add_outline(layer, m.point(lambda v: 255 if v > 128 else 0) if soft else m, outline, ow)


def star4(cx, cy, r, inner=0.20):
    pts = []
    for i in range(4):
        a = -np.pi / 2 + i * np.pi / 2
        pts.append((cx + r * np.cos(a), cy + r * np.sin(a)))
        b = a + np.pi / 4
        pts.append((cx + r * inner * np.cos(b), cy + r * inner * np.sin(b)))
    return pts


def sparkle(layer, cx, cy, r, color=(255, 246, 212), glow=90):
    if glow:
        g = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(g).polygon(seg(star4(cx, cy, r * 2.0, 0.15)), fill=color + (glow,))
        layer.alpha_composite(g.filter(ImageFilter.GaussianBlur(30)))
    d = ImageDraw.Draw(layer)
    d.polygon(seg(star4(cx, cy, r)), fill=color + (255,))
    d.polygon(seg(star4(cx, cy, r * 0.42)), fill=(255, 255, 255, 255))


# ---------------- 背景 ----------------
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(vgrad3((255, 254, 250), (255, 247, 238), (250, 241, 233)), (0, 0))

halo = Image.new("RGBA", (S, S), (206, 232, 252, 255))
halo.putalpha(radial(1050, 1100, 840, 1.5, 175))
img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(80)))

bgd = ImageDraw.Draw(img)
rng = np.random.default_rng(4)
for _ in range(30):
    x, y = rng.integers(70, 1980), rng.integers(110, 1620)
    r = rng.integers(3, 9)
    bgd.ellipse((x - r, y - r, x + r, y + r), fill=(108, 164, 214, 26))
for cx, cy, r in [(1730, 300, 90), (300, 1500, 110), (1820, 1240, 70)]:
    bgd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(150, 198, 238, 20))

# 地面阴影
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(sh).ellipse((540, 1700, 1560, 1880), fill=(116, 136, 176, 105))
img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(55)))

# ---------------- 角色 ----------------
ch = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 鲸尾（右后）
tail_mask = mask_of(lambda d: (
    d.polygon(seg(ell_pts(1420, 1540, 58, 108)), fill=255),
    d.polygon(seg(ell_pts(1596, 1466, 178, 66, -0.40)), fill=255),
    d.polygon(seg(ell_pts(1616, 1622, 178, 66, 0.42)), fill=255)))
paint(ch, tail_mask, vgrad3((78, 142, 212), (38, 80, 150), (24, 48, 100)), NAVY, 13)
td = ImageDraw.Draw(ch)
for a, b, c in [((1470, 1490), (1552, 1448), (1636, 1424)),
                ((1490, 1546), (1572, 1528), (1652, 1516)),
                ((1480, 1600), (1558, 1632), (1640, 1656))]:
    td.line([tuple(map(int, q)) for q in catmull([a, b, c], 16)],
            fill=(160, 214, 248, 105), width=8, joint="curve")

# 身体
body_mask = mask_of(lambda d: d.ellipse((520, 620, 1560, 1660), fill=255))
paint(ch, body_mask, vgrad3((136, 200, 248), (66, 124, 208), (32, 62, 134)))
hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(hl).ellipse((620, 640, 1080, 1060), fill=(255, 255, 255, 120))
ch.alpha_composite(Image.composite(hl.filter(ImageFilter.GaussianBlur(80)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
dk = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(dk).ellipse((900, 1160, 1580, 1680), fill=(16, 40, 92, 90))
ch.alpha_composite(Image.composite(dk.filter(ImageFilter.GaussianBlur(80)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
add_outline(ch, body_mask, NAVY, 15)

# 白肚（只在下半身，被碗挡住大半）
belly_mask = mask_of(lambda d: d.ellipse((700, 1338, 1380, 1740), fill=255))
belly = Image.new("RGBA", (S, S), (0, 0, 0, 0))
belly.paste(vgrad3((255, 255, 255), (246, 251, 255), (212, 234, 252)), (0, 0))
belly.putalpha(belly_mask.filter(ImageFilter.GaussianBlur(14)))
ch.alpha_composite(belly)

# 头鳍（鲸鳍，向外下方，尖端略尖）
def head_fin(sign):
    cx, cy = (528, 962) if sign < 0 else (1552, 962)
    ang = -0.30 if sign < 0 else 0.30
    base = ell_pts(cx, cy, 148, 72, ang)
    tipx = cx + (-1 if sign < 0 else 1) * 205
    tipy = cy + 44
    tri = [(cx + (-1 if sign < 0 else 1) * 60, cy - 66),
           (tipx, tipy),
           (cx + (-1 if sign < 0 else 1) * 60, cy + 66)]
    m = mask_of(lambda d: (d.polygon(seg(base), fill=255), d.polygon(seg(tri), fill=255)))
    paint(ch, m, vgrad3((92, 158, 226), (42, 86, 158), (26, 50, 104)), NAVY, 13)
    inner = ImageDraw.Draw(ch)
    # 高光条
    hl_pts = ell_pts(cx - (26 if sign < 0 else -26), cy - 12, 100, 30, ang)
    inner.polygon(seg(hl_pts), fill=(168, 218, 250, 55))
    for k in (0.25, 0.55, 0.85):
        p0 = (cx + (-1 if sign < 0 else 1) * (40 + 120 * k), cy - 46 + 18 * k)
        p1 = (cx + (-1 if sign < 0 else 1) * (90 + 110 * k), cy + 10 * k)
        p2 = (cx + (-1 if sign < 0 else 1) * (120 + 90 * k), cy + 52 - 6 * k)
        inner.line([tuple(map(int, q)) for q in catmull([p0, p1, p2], 10)],
                   fill=(150, 204, 246, 90), width=6, joint="curve")


head_fin(-1)
head_fin(1)

# ---------------- 脸 ----------------
def eye(cx, cy, flip):
    m = mask_of(lambda d: d.ellipse((cx - 106, cy - 126, cx + 106, cy + 126), fill=255))
    iris = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    iris.paste(vgrad3((12, 24, 56), (32, 82, 160), (126, 210, 252)), (0, 0))
    iris.putalpha(m)
    ch.alpha_composite(iris)
    # 瞳孔柔和
    pm = mask_of(lambda dd: dd.ellipse((cx - 54, cy - 54, cx + 50, cy + 70), fill=255)).filter(ImageFilter.GaussianBlur(20))
    p = Image.new("RGBA", (S, S), (8, 14, 34, 175))
    p.putalpha(ImageChops.multiply(pm, m))
    ch.alpha_composite(p)
    d = ImageDraw.Draw(ch)
    d.ellipse((cx - 74, cy - 102, cx + 2, cy - 24), fill=(255, 255, 255, 252))
    d.ellipse((cx - 60, cy - 90, cx - 12, cy - 40), fill=(255, 255, 255, 255))
    d.ellipse((cx + 32, cy + 44, cx + 62, cy + 74), fill=(255, 255, 255, 235))
    d.polygon(seg(star4(cx + 2, cy + 60, 24, 0.24)), fill=(255, 250, 222, 255))
    d.polygon(seg(star4(cx + 2, cy + 60, 9, 0.3)), fill=(255, 255, 255, 255))
    add_outline(ch, m, NAVY, 12)
    ex = cx + flip * 104
    d.line([(ex - flip * 2, cy - 112), (ex + flip * 50, cy - 152)], fill=NAVY, width=13)
    d.line([(ex - flip * 8, cy - 76), (ex + flip * 58, cy - 98)], fill=NAVY, width=11)


eye(882, 1056, -1)
eye(1182, 1056, 1)

# 腮红
for cx in (700, 1352):
    b = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    b.paste(Image.new("RGBA", (S, S), (247, 150, 172, 255)), (0, 0))
    b.putalpha(radial(cx, 1218, 110, 1.9, 118))
    ch.alpha_composite(b)

# 嘴
mouth_mask = mask_of(lambda d: d.pieslice((982, 1224, 1104, 1320), 0, 180, fill=255))
paint(ch, mouth_mask, (106, 36, 54, 255), NAVY, 9)
tongue = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(tongue).ellipse((1006, 1266, 1082, 1316), fill=(246, 142, 162, 255))
tongue.putalpha(ImageChops.multiply(tongue.split()[3], mouth_mask))
ch.alpha_composite(tongue)
ImageDraw.Draw(ch).polygon(seg([(1012, 1230), (1036, 1228), (1022, 1252)]), fill=(255, 255, 255, 255))

# 腮帮米粒
for cx, cy, r in [(1138, 1246, 11), (1162, 1232, 9), (1116, 1228, 8)]:
    dd = ImageDraw.Draw(ch)
    dd.ellipse((cx - r, cy - r * .8, cx + r, cy + r * .8), fill=(255, 255, 255, 245),
               outline=(198, 182, 158, 200), width=3)

# ---------------- 饭碗 ----------------
bowl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
BOWL_LINE = (70, 104, 152, 255)
RIM_Y, RIM_RX, RIM_RY = 1512, 288, 60
body_mask_b = ImageChops.multiply(
    mask_of(lambda d: d.ellipse((1032 - RIM_RX, RIM_Y - 56, 1032 + RIM_RX, 1822), fill=255)),
    mask_of(lambda d: d.rectangle((0, RIM_Y, S, S), fill=255)))
paint(bowl, body_mask_b, vgrad3((255, 255, 255), (247, 251, 255), (204, 224, 243)), BOWL_LINE, 11)

bwd = ImageDraw.Draw(bowl)
# 碗内 / 碗口
bwd.ellipse((1032 - RIM_RX, RIM_Y - RIM_RY, 1032 + RIM_RX, RIM_Y + RIM_RY),
            fill=(226, 242, 253, 255), outline=BOWL_LINE, width=11)
# 蓝边环
bwd.arc((1032 - RIM_RX + 10, RIM_Y + 96, 1032 + RIM_RX - 10, RIM_Y + 196), 0, 180,
        fill=(86, 138, 198, 255), width=15)
bwd.arc((1032 - RIM_RX + 20, RIM_Y - 52, 1032 + RIM_RX - 20, RIM_Y + 30), 14, 166,
        fill=(120, 176, 224, 150), width=8)
# 高光
bwd.arc((1032 - 210, RIM_Y + 10, 1032 + 60, RIM_Y + 270), 100, 166,
        fill=(255, 255, 255, 235), width=13)
bwd.arc((1032 - 160, RIM_Y + 26, 1032 - 30, RIM_Y + 96), 200, 330,
        fill=(255, 255, 255, 245), width=8)

# 小鲸鱼印花
wb = catmull([(1000, 1666), (1008, 1638), (1038, 1624), (1074, 1624),
              (1106, 1634), (1122, 1654), (1102, 1674), (1064, 1682), (1026, 1678)])
bwd.polygon(seg(wb), fill=(46, 82, 124, 255))
bwd.polygon(seg([(1116, 1634), (1156, 1606), (1152, 1660)]), fill=(46, 82, 124, 255))
bwd.polygon(seg([(1032, 1680), (1024, 1700), (1052, 1688)]), fill=(46, 82, 124, 255))
bwd.ellipse((1028, 1644, 1042, 1658), fill=(255, 255, 255, 255))
for dx, dy in [(0, 0), (-14, 8), (14, 8)]:
    bwd.arc((1042 + dx, 1588 + dy, 1068 + dx, 1618 + dy), 200, 340,
            fill=(118, 170, 214, 255), width=5)

# ---------------- 米饭 ----------------
rice = Image.new("RGBA", (S, S), (0, 0, 0, 0))
mound = catmull([(800, 1508), (806, 1442), (858, 1394), (944, 1372),
                 (1052, 1372), (1148, 1398), (1214, 1446), (1232, 1508), (1016, 1540)])
rmask = mask_of(lambda d: d.polygon(seg(mound), fill=255))
paint(rice, rmask, (255, 255, 255, 255), (200, 186, 162, 255), 9)
rd = ImageDraw.Draw(rice)
grains = [(846, 1446, 29), (902, 1408, 27), (962, 1396, 29), (1024, 1394, 27),
          (1086, 1408, 27), (1142, 1440, 25), (1188, 1478, 23), (876, 1492, 25),
          (938, 1476, 27), (1000, 1476, 27), (1062, 1482, 25), (1118, 1506, 21)]
for cx, cy, r in grains:
    rd.ellipse((cx - r, cy - r * .74, cx + r, cy + r * .74), fill=(255, 255, 255, 255),
               outline=(214, 200, 176, 150), width=3)
    rd.arc((cx - r * .64, cy - r * .5, cx + r * .64, cy + r * .34), 195, 350,
           fill=(255, 255, 255, 255), width=4)
rsh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(rsh).ellipse((846, 1456, 1190, 1532), fill=(178, 160, 132, 60))
rice.alpha_composite(Image.composite(rsh.filter(ImageFilter.GaussianBlur(18)),
                                     Image.new("RGBA", (S, S), (0, 0, 0, 0)), rmask))

ch.alpha_composite(bowl)
ch.alpha_composite(rice)
# 碗口前沿压在米饭上
bwd = ImageDraw.Draw(ch)
bwd.arc((1032 - RIM_RX, RIM_Y - RIM_RY, 1032 + RIM_RX, RIM_Y + RIM_RY), 0, 180,
        fill=(250, 253, 255, 255), width=26)
bwd.arc((1032 - RIM_RX, RIM_Y - RIM_RY, 1032 + RIM_RX, RIM_Y + RIM_RY), 2, 178,
        fill=BOWL_LINE, width=6)

# ---------------- 抱碗的小鳍 ----------------
def hug_fin(pts, rays):
    m = mask_of(lambda d: d.polygon(seg(catmull(pts)), fill=255))
    paint(ch, m, vgrad3((138, 202, 248), (62, 118, 200), (34, 66, 140)), NAVY, 11)
    d = ImageDraw.Draw(ch)
    for a, b, c in rays:
        d.line([tuple(map(int, q)) for q in catmull([a, b, c], 14)],
               fill=(184, 230, 252, 135), width=7, joint="curve")


hug_fin([(760, 1402), (816, 1420), (856, 1474), (858, 1550), (818, 1608),
         (756, 1582), (736, 1512), (738, 1440)],
        [((790, 1446), (820, 1502), (820, 1580)), ((818, 1454), (846, 1508), (838, 1570))])
hug_fin([(1320, 1402), (1264, 1420), (1224, 1474), (1222, 1550), (1262, 1608),
         (1324, 1582), (1344, 1512), (1342, 1440)],
        [((1290, 1446), (1260, 1502), (1260, 1580)), ((1262, 1454), (1234, 1508), (1242, 1570))])

# ---------------- 喷水 ----------------
sp = ImageDraw.Draw(ch)
for dx, r in [(-60, 15), (0, 19), (60, 15)]:
    sp.ellipse((1058 + dx - r, 556 - r, 1058 + dx + r, 556 + r),
               fill=(202, 236, 255, 255), outline=(124, 180, 222, 225), width=5)
    sp.ellipse((1058 + dx - r * .55, 556 - r * .85, 1058 + dx + r * .15, 556 - r * .15),
               fill=(255, 255, 255, 235))
for dx in (-1, 1):
    p = [tuple(map(int, q)) for q in catmull([(1058 + dx * 24, 650),
                                              (1024 + dx * 64, 614),
                                              (1058 + dx * 30, 578)], 16)]
    sp.line(p, fill=(184, 226, 250, 205), width=8, joint="curve")

img.alpha_composite(ch)

# ---------------- 星星 ----------------
for cx, cy, r in [(412, 608, 38), (1626, 536, 32), (1766, 952, 24), (334, 1072, 20),
                  (1548, 1152, 16), (632, 842, 14)]:
    sparkle(img, cx, cy, r, glow=70)

# ---------------- 气泡 ----------------
bub = Image.new("RGBA", (S, S), (0, 0, 0, 0))
b1 = ImageDraw.Draw(bub)
b1.polygon(seg([(596, 458), (724, 636), (768, 452)]), fill=PAPER + (255,), outline=NAVY)
b1.rounded_rectangle((118, 120, 984, 484), radius=64, fill=PAPER + (255,))
img.alpha_composite(bub)
b2 = ImageDraw.Draw(img)
b2.rounded_rectangle((118, 120, 984, 484), radius=64, outline=NAVY, width=12)
b2.line(seg([(174, 168), (318, 168)]), fill=(255, 206, 218, 230), width=8, joint="curve")

f_big = ImageFont.truetype(FONT_B, 102, index=0)
f_small = ImageFont.truetype(FONT_B, 54, index=0)
dt = ImageDraw.Draw(img)
x = 178
for txt, col in [("还没吃饱", NAVY), ("喵", (224, 92, 126, 255)), ("！", NAVY)]:
    dt.text((x, 174), txt, font=f_big, fill=col)
    x += dt.textlength(txt, font=f_big)
dt.text((182, 348), "铲屎官，饭呢？", font=f_small, fill=(78, 92, 126, 255))

out = img.convert("RGB").resize((OUT, OUT), Image.LANCZOS)
out.save("blue-fat-fish-selfie.png")
print("saved", out.size, "| eyes", "ok")
