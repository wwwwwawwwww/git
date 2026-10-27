# -*- coding: utf-8 -*-
"""本鱼自画像 v4 —— 蓝色大肥鱼（DeepSeek 鲸鱼娘 mascot）。
深蓝渐变 / 鲸鳍 / 鲸尾 / 白肚 / 鲸鱼印花的饭碗 / 星星眼 / 没吃饱喵
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont

S = 2048
OUT = 1024
FONT_B = "C:/Windows/Fonts/msyhbd.ttc"

NAVY = (24, 36, 72, 255)
INK = (34, 54, 108)
WHITE = (252, 253, 255)
PAPER = (255, 253, 247)

# ---------------- 工具 ----------------
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


def catmull(pts, n=26, closed=True):
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


def ell_pts(cx, cy, rx, ry, ang=0.0, n=140):
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
img.paste(vgrad3((255, 254, 250), (255, 247, 238), (249, 240, 232)), (0, 0))

halo = Image.new("RGBA", (S, S), (203, 230, 252, 255))
halo.putalpha(radial(1050, 1120, 860, 1.5, 190))
img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(80)))

bgd = ImageDraw.Draw(img)
for cx, cy, r, a in [(1760, 340, 120, 22), (250, 1420, 150, 18), (1800, 1520, 90, 16)]:
    bgd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(120, 176, 226, a))
rng = np.random.default_rng(9)
for _ in range(24):
    x, y = rng.integers(80, 1970), rng.integers(120, 1560)
    r = rng.integers(4, 11)
    bgd.ellipse((x - r, y - r, x + r, y + r), fill=(110, 166, 216, 26))

# 地面阴影
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(sh).ellipse((520, 1690, 1580, 1870), fill=(116, 136, 176, 105))
img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(55)))

# ---------------- 角色 ----------------
ch = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 鲸尾（身后，右侧）
tail_mask = mask_of(lambda d: (
    d.polygon(seg(ell_pts(1440, 1500, 64, 120)), fill=255),
    d.polygon(seg(ell_pts(1620, 1402, 200, 74, -0.42)), fill=255),
    d.polygon(seg(ell_pts(1650, 1586, 200, 74, 0.46)), fill=255)))
paint(ch, tail_mask, vgrad3((86, 152, 220), (42, 86, 158), (25, 50, 104)), NAVY, 13)
td = ImageDraw.Draw(ch)
for a, b, c in [((1480, 1450), (1570, 1400), (1660, 1372)),
                ((1500, 1520), (1590, 1490), (1690, 1472)),
                ((1490, 1580), (1580, 1620), (1668, 1652))]:
    td.line([tuple(map(int, q)) for q in catmull([a, b, c], 16)],
            fill=(158, 212, 248, 110), width=8, joint="curve")

# 身体
body_mask = mask_of(lambda d: d.ellipse((520, 620, 1560, 1660), fill=255))
paint(ch, body_mask, vgrad3((134, 198, 248), (66, 124, 208), (32, 62, 134)))
hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(hl).ellipse((620, 640, 1080, 1060), fill=(255, 255, 255, 120))
ch.alpha_composite(Image.composite(hl.filter(ImageFilter.GaussianBlur(80)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
dk = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(dk).ellipse((900, 1160, 1580, 1680), fill=(16, 40, 92, 90))
ch.alpha_composite(Image.composite(dk.filter(ImageFilter.GaussianBlur(80)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
add_outline(ch, body_mask, NAVY, 15)

# 白肚皮（鲸腹），边缘干净
belly_mask = mask_of(lambda d: d.ellipse((742, 1152, 1338, 1688), fill=255))
belly = Image.new("RGBA", (S, S), (0, 0, 0, 0))
belly.paste(vgrad3((255, 255, 255), (246, 251, 255), (214, 235, 252)), (0, 0))
belly.putalpha(belly_mask.filter(ImageFilter.GaussianBlur(7)))
ch.alpha_composite(belly)
# 肚皮上沿的一点蓝影
bedge = ImageChops.subtract(belly_mask, erode(belly_mask, 22)).filter(ImageFilter.GaussianBlur(10))
be = Image.new("RGBA", (S, S), (108, 160, 214, 60))
be.putalpha(bedge)
ch.alpha_composite(be)

# 鲸耳鳍 / 头鳍（两侧，朝外下）
def head_fin(sign):
    if sign < 0:
        pts = [(648, 900), (500, 848), (392, 902), (404, 1000), (500, 1062), (614, 1020)]
    else:
        pts = [(1412, 900), (1560, 848), (1668, 902), (1656, 1000), (1560, 1062), (1446, 1020)]
    m = mask_of(lambda d: d.polygon(seg(catmull(pts)), fill=255))
    paint(ch, m, vgrad3((96, 162, 230), (44, 88, 160), (26, 52, 108)), NAVY, 13)
    inner = catmull([(x + (46 if sign < 0 else -46), y + 10) for x, y in pts])
    ImageDraw.Draw(ch).polygon(seg(inner), fill=(150, 206, 250, 70))
    r = ImageDraw.Draw(ch)
    for a, b, c in [((pts[0][0], pts[0][1] + 8), (pts[2][0], pts[2][1] + 10), (pts[4][0], pts[4][1])),
                    ((pts[0][0], pts[0][1] + 8), (pts[2][0], pts[2][1] + 44), (pts[4][0], pts[4][1] + 10))]:
        r.line([tuple(map(int, q)) for q in catmull([a, b, c], 12)],
               fill=(176, 226, 252, 120), width=7, joint="curve")


head_fin(-1)
head_fin(1)

# ---------------- 脸 ----------------
def eye(cx, cy, flip):
    d = ImageDraw.Draw(ch)
    d.ellipse((cx - 112, cy - 132, cx + 112, cy + 132), fill=WHITE, outline=NAVY, width=11)
    iris_mask = mask_of(lambda dd: dd.ellipse((cx - 100, cy - 120, cx + 100, cy + 118), fill=255))
    iris = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    iris.paste(vgrad3((15, 27, 62), (34, 84, 162), (116, 198, 248)), (0, 0))
    iris.putalpha(iris_mask)
    ch.alpha_composite(iris)
    # 瞳孔
    d.ellipse((cx - 48, cy - 66, cx + 44, cy + 32), fill=(9, 16, 40, 255))
    # 高光
    d.ellipse((cx - 74, cy - 104, cx + 4, cy - 26), fill=(255, 255, 255, 252))
    d.ellipse((cx - 60, cy - 92, cx - 12, cy - 44), fill=(255, 255, 255, 255))
    d.ellipse((cx + 36, cy + 44, cx + 66, cy + 74), fill=(255, 255, 255, 240))
    # 星星
    d.polygon(seg(star4(cx + 8, cy + 56, 24, 0.24)), fill=(255, 250, 224, 255))
    d.polygon(seg(star4(cx + 8, cy + 56, 9, 0.3)), fill=(255, 255, 255, 255))
    d.ellipse((cx - 112, cy - 132, cx + 112, cy + 132), outline=NAVY, width=9)
    # 外侧睫毛
    ex = cx + flip * 106
    d.line([(ex, cy - 116), (ex + flip * 46, cy - 154)], fill=NAVY, width=12)
    d.line([(ex + flip * 4, cy - 84), (ex + flip * 54, cy - 108)], fill=NAVY, width=10)


eye(884, 1058, -1)
eye(1180, 1058, 1)

# 腮红
for cx in (706, 1352):
    b = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    b.paste(Image.new("RGBA", (S, S), (247, 150, 172, 255)), (0, 0))
    b.putalpha(radial(cx, 1210, 112, 1.9, 115))
    ch.alpha_composite(b)

# 嘴：开心张嘴
mouth_mask = mask_of(lambda d: d.pieslice((968, 1214, 1104, 1322), 0, 180, fill=255))
paint(ch, mouth_mask, (108, 38, 56, 255), NAVY, 9)
tongue = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(tongue).ellipse((998, 1262, 1080, 1318), fill=(246, 142, 162, 255))
tongue.putalpha(ImageChops.multiply(tongue.split()[3], mouth_mask))
ch.alpha_composite(tongue)
# 小虎牙
ImageDraw.Draw(ch).polygon(seg([(1000, 1224), (1026, 1222), (1010, 1246)]), fill=(255, 255, 255, 255))

# ---------------- 饭碗（白瓷 + 蓝边 + 小鲸鱼印花） ----------------
bowl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
BOWL_LINE = (72, 106, 156, 255)
rim_y = 1508
body_mask_b = ImageChops.multiply(
    mask_of(lambda d: d.ellipse((752, rim_y - 60, 1328, 1812), fill=255)),
    mask_of(lambda d: d.rectangle((0, rim_y, S, S), fill=255)))
paint(bowl, body_mask_b, vgrad3((255, 255, 255), (246, 250, 254), (206, 226, 244)), BOWL_LINE, 11)

bwd = ImageDraw.Draw(bowl)
# 碗口
bwd.ellipse((752, rim_y - 66, 1328, rim_y + 62), fill=(253, 254, 255, 255),
            outline=BOWL_LINE, width=11)
bwd.ellipse((796, rim_y - 44, 1284, rim_y + 40), fill=(255, 255, 255, 255))
# 蓝边环
bwd.arc((766, rim_y + 118, 1314, rim_y + 202), 0, 180, fill=(88, 140, 200, 255), width=14)
bwd.arc((790, rim_y - 20, 1290, rim_y + 30), 12, 168, fill=(120, 172, 222, 160), width=8)
# 高光
bwd.arc((800, rim_y - 10, 1010, rim_y + 250), 100, 166, fill=(255, 255, 255, 225), width=13)
bwd.arc((836, rim_y + 10, 920, rim_y + 70), 200, 330, fill=(255, 255, 255, 245), width=8)

# 小鲸鱼印花
wb = catmull([(944, 1666), (954, 1636), (986, 1622), (1024, 1620),
              (1058, 1630), (1074, 1652), (1052, 1674), (1012, 1684), (972, 1678)])
bwd.polygon(seg(wb), fill=(48, 84, 126, 255))
bwd.polygon(seg([(1068, 1630), (1108, 1602), (1104, 1656)]), fill=(48, 84, 126, 255))
bwd.polygon(seg([(980, 1680), (972, 1700), (1000, 1688)]), fill=(48, 84, 126, 255))
bwd.ellipse((972, 1640, 986, 1654), fill=(255, 255, 255, 255))
for dx, dy in [(0, 0), (-14, 8), (14, 8)]:
    bwd.arc((986 + dx, 1584 + dy, 1012 + dx, 1614 + dy), 200, 340, fill=(120, 172, 214, 255), width=5)

# ---------------- 米饭 ----------------
rice = Image.new("RGBA", (S, S), (0, 0, 0, 0))
mound = catmull([(792, 1512), (798, 1440), (846, 1388), (936, 1362),
                 (1046, 1360), (1140, 1390), (1206, 1446), (1224, 1512), (1008, 1538)])
rmask = mask_of(lambda d: d.polygon(seg(mound), fill=255))
paint(rice, rmask, (255, 255, 255, 255), (198, 184, 160, 255), 9)
rd = ImageDraw.Draw(rice)
grains = [(838, 1450, 30), (896, 1408, 28), (958, 1394, 30), (1022, 1392, 28),
          (1086, 1406, 28), (1144, 1438, 26), (1190, 1478, 24), (872, 1494, 26),
          (936, 1478, 28), (1000, 1478, 28), (1064, 1484, 26), (1122, 1508, 22)]
for cx, cy, r in grains:
    rd.ellipse((cx - r, cy - r * .74, cx + r, cy + r * .74), fill=(255, 255, 255, 255),
               outline=(214, 200, 176, 160), width=3)
    rd.arc((cx - r * .66, cy - r * .52, cx + r * .66, cy + r * .36), 195, 350,
           fill=(255, 255, 255, 255), width=4)
rsh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(rsh).ellipse((838, 1456, 1186, 1530), fill=(176, 158, 130, 65))
rice.alpha_composite(Image.composite(rsh.filter(ImageFilter.GaussianBlur(18)),
                                     Image.new("RGBA", (S, S), (0, 0, 0, 0)), rmask))

ch.alpha_composite(bowl)
ch.alpha_composite(rice)

# ---------------- 抱碗小鳍 ----------------
def hug_fin(pts, rays):
    m = mask_of(lambda d: d.polygon(seg(catmull(pts)), fill=255))
    paint(ch, m, vgrad3((136, 200, 248), (62, 118, 200), (34, 66, 140)), NAVY, 11)
    d = ImageDraw.Draw(ch)
    for a, b, c in rays:
        d.line([tuple(map(int, q)) for q in catmull([a, b, c], 14)],
               fill=(180, 228, 252, 140), width=7, joint="curve")


hug_fin([(742, 1428), (796, 1444), (836, 1498), (838, 1570), (800, 1628),
         (742, 1600), (722, 1532), (724, 1464)],
        [((770, 1470), (800, 1524), (800, 1598)), ((798, 1478), (826, 1530), (818, 1590))])
hug_fin([(1338, 1428), (1284, 1444), (1244, 1498), (1242, 1570), (1280, 1628),
         (1338, 1600), (1358, 1532), (1356, 1464)],
        [((1310, 1470), (1280, 1524), (1280, 1598)), ((1282, 1478), (1254, 1530), (1262, 1590))])

# ---------------- 喷水 ----------------
sp = ImageDraw.Draw(ch)
for dx, r in [(-58, 15), (0, 19), (58, 15)]:
    sp.ellipse((1058 + dx - r, 558 - r, 1058 + dx + r, 558 + r),
               fill=(200, 236, 255, 255), outline=(124, 180, 222, 225), width=5)
    sp.ellipse((1058 + dx - r * .55, 558 - r * .85, 1058 + dx + r * .15, 558 - r * .15),
               fill=(255, 255, 255, 235))
for dx in (-1, 1):
    p = [tuple(map(int, q)) for q in catmull([(1058 + dx * 24, 652),
                                              (1024 + dx * 64, 616),
                                              (1058 + dx * 30, 580)], 16)]
    sp.line(p, fill=(182, 224, 250, 210), width=8, joint="curve")

img.alpha_composite(ch)

# ---------------- 星星 ----------------
for cx, cy, r in [(418, 612, 38), (1622, 540, 32), (1758, 960, 24), (338, 1076, 20),
                  (1540, 1160, 16), (628, 846, 14)]:
    sparkle(img, cx, cy, r, glow=70)

# ---------------- 对话气泡 ----------------
bub = Image.new("RGBA", (S, S), (0, 0, 0, 0))
b1 = ImageDraw.Draw(bub)
b1.polygon(seg([(640, 470), (806, 664), (748, 456)]), fill=PAPER + (255,), outline=NAVY)
b1.rounded_rectangle((120, 122, 986, 486), radius=64, fill=PAPER + (255,))
img.alpha_composite(bub)
b2 = ImageDraw.Draw(img)
b2.rounded_rectangle((120, 122, 986, 486), radius=64, outline=NAVY, width=12)
b2.line(seg([(176, 170), (320, 170)]), fill=(255, 206, 218, 230), width=8, joint="curve")

f_big = ImageFont.truetype(FONT_B, 102, index=0)
f_small = ImageFont.truetype(FONT_B, 54, index=0)
dt = ImageDraw.Draw(img)
x = 180
for txt, col in [("还没吃饱", NAVY), ("喵", (224, 92, 126, 255)), ("！", NAVY)]:
    dt.text((x, 176), txt, font=f_big, fill=col)
    x += dt.textlength(txt, font=f_big)
dt.text((184, 350), "铲屎官，饭呢？", font=f_small, fill=(78, 92, 126, 255))

out = img.convert("RGB").resize((OUT, OUT), Image.LANCZOS)
out.save("blue-fat-fish-selfie.png")
print("saved", out.size)
