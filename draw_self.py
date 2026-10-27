# -*- coding: utf-8 -*-
"""本鱼的自画像 v2 —— 蓝色胖鱼，抱着印着小鲸鱼的饭碗，星星眼摆烂中。"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 2048
OUT = 1024

# ---------------- 基础工具 ----------------

def vgrad(c1, c2, size=S):
    h = np.linspace(0, 1, size)[:, None, None]
    a = np.array(c1, float)[None, None, :]
    b = np.array(c2, float)[None, None, :]
    arr = (a + (b - a) * h).repeat(size, axis=1).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def radial_alpha(cx, cy, r, power=1.4, peak=255):
    y, x = np.mgrid[0:S, 0:S]
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
    a = np.clip(1 - d, 0, 1) ** power
    return Image.fromarray((a * peak).astype(np.uint8), "L")


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


def ell_pts(cx, cy, rx, ry, ang=0.0, n=120):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    x, y = rx * np.cos(t), ry * np.sin(t)
    ca, sa = np.cos(ang), np.sin(ang)
    return [(cx + u * ca - v * sa, cy + u * sa + v * ca) for u, v in zip(x, y)]


def mask_of(draw_fn):
    m = Image.new("L", (S, S), 0)
    draw_fn(ImageDraw.Draw(m))
    return m


def erode(mask, px):
    m = mask
    for _ in range(max(1, int(px))):
        m = m.filter(ImageFilter.MinFilter(3))
    return m


def add_outline(layer, mask, color, ow=12, soft=1.0):
    edge = ImageChops.subtract(mask, erode(mask, ow))
    if soft:
        edge = edge.filter(ImageFilter.GaussianBlur(soft))
    o = Image.new("RGBA", (S, S), color)
    o.putalpha(edge)
    layer.alpha_composite(o)


def paint(layer, mask, fill, outline=None, ow=12, soft_edge=0):
    if soft_edge:
        mask = mask.filter(ImageFilter.GaussianBlur(soft_edge))
    if isinstance(fill, Image.Image):
        tmp = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        tmp.paste(fill.convert("RGB"), (0, 0), mask)
    else:
        tmp = Image.new("RGBA", (S, S), fill)
        tmp.putalpha(mask)
    layer.alpha_composite(tmp)
    if outline:
        add_outline(layer, mask if not soft_edge else mask.point(lambda v: 255 if v > 110 else 0),
                    outline, ow, soft=1.2)


def star4(cx, cy, r, inner=0.20):
    pts = []
    for i in range(4):
        a = -np.pi / 2 + i * np.pi / 2
        pts.append((cx + r * np.cos(a), cy + r * np.sin(a)))
        b = a + np.pi / 4
        pts.append((cx + r * inner * np.cos(b), cy + r * inner * np.sin(b)))
    return pts


def sparkle(layer, cx, cy, r, color=(255, 252, 228), glow=90):
    if glow:
        g = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(g).polygon(star4(cx, cy, r * 2.1, 0.16), fill=color + (glow,))
        g = g.filter(ImageFilter.GaussianBlur(26))
        layer.alpha_composite(g)
    d = ImageDraw.Draw(layer)
    d.polygon(star4(cx, cy, r), fill=color + (255,))
    d.polygon(star4(cx, cy, r * 0.45), fill=(255, 255, 255, 255))


# ---------------- 背景 ----------------
canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
outer = vgrad((255, 249, 241), (246, 226, 238))
canvas.paste(outer, (0, 0))

art = Image.new("RGBA", (S, S), (0, 0, 0, 0))
art.paste(vgrad((206, 243, 255), (60, 160, 205)), (0, 0))

# 光柱
rays = Image.new("RGBA", (S, S), (0, 0, 0, 0))
rd = ImageDraw.Draw(rays)
for x0, w, spread in [(120, 130, 420), (360, 100, 330), (650, 80, 260)]:
    rd.polygon([(x0, 56), (x0 + w, 56), (x0 + w + spread, 1980), (x0 - 150, 1980)],
               fill=(255, 255, 255, 20))
art.alpha_composite(rays.filter(ImageFilter.GaussianBlur(45)))

# 沙底
sand = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(sand)
sd.polygon([(40, 1772), (380, 1728), (820, 1758), (1240, 1722), (1690, 1752),
            (2010, 1718), (2010, 2010), (40, 2010)], fill=(247, 229, 193, 255))
sd.polygon([(40, 1866), (520, 1834), (1024, 1872), (1520, 1832), (2010, 1866),
            (2010, 2010), (40, 2010)], fill=(234, 209, 167, 255))
rng = np.random.default_rng(11)
for _ in range(110):
    x = rng.integers(70, 1980); y = rng.integers(1768, 1990)
    r = rng.integers(4, 12)
    c = rng.choice([(218, 190, 148), (255, 243, 215), (204, 178, 140)])
    sd.ellipse((x - r, y - r * 0.6, x + r, y + r * 0.6), fill=tuple(int(v) for v in c) + (170,))
# 沙上的光斑
for cx, cy, rx, ry in [(520, 1830, 150, 26), (1180, 1808, 190, 30), (1620, 1840, 120, 20)]:
    art.alpha_composite(Image.new("RGBA", (S, S), (0, 0, 0, 0)))
    g = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(g).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=(255, 250, 225, 90))
    art.alpha_composite(g.filter(ImageFilter.GaussianBlur(24)))
art.alpha_composite(sand)


def bezier(p0, p1, p2, n=40):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2 = map(np.array, (p0, p1, p2))
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2


def blade(layer, p0, p1, p2, w0, color, outline):
    pts = bezier(p0, p1, p2, 48)
    left, right = [], []
    for i, p in enumerate(pts):
        if i == 0:
            d = pts[1] - pts[0]
        elif i == len(pts) - 1:
            d = pts[-1] - pts[-2]
        else:
            d = pts[i + 1] - pts[i - 1]
        L = np.hypot(*d) or 1
        nx, ny = -d[1] / L, d[0] / L
        w = w0 * (1 - i / (len(pts) - 1)) ** 0.7
        left.append((p[0] + nx * w / 2, p[1] + ny * w / 2))
        right.append((p[0] - nx * w / 2, p[1] - ny * w / 2))
    p = [(int(x), int(y)) for x, y in left + right[::-1]]
    d = ImageDraw.Draw(layer)
    d.polygon(p, fill=color)
    d.line(p + [p[0]], fill=outline, width=7, joint="curve")
    r = max(3, w0 * 0.05)
    d.ellipse((pts[-1][0] - r, pts[-1][1] - r, pts[-1][0] + r, pts[-1][1] + r), fill=color)


plants = Image.new("RGBA", (S, S), (0, 0, 0, 0))
for bx, tx, ty, w, col in [
        (150, 95, 1150, 60, (52, 150, 106)), (230, 300, 980, 54, (66, 170, 122)),
        (320, 250, 1270, 48, (44, 134, 94)), (415, 500, 1100, 42, (74, 182, 130)),
        (470, 560, 1420, 36, (58, 158, 110))]:
    blade(plants, (bx, 1810), (bx + (tx - bx) * .5, (1810 + ty) / 2 - 60), (tx, ty),
          w, col + (255,), (26, 96, 68, 230))
for bx, tx, ty, w, col in [
        (1930, 1990, 1120, 58, (52, 150, 106)), (1850, 1770, 950, 52, (66, 170, 122)),
        (1760, 1680, 1220, 46, (44, 134, 94)), (1680, 1600, 1450, 38, (74, 182, 130))]:
    blade(plants, (bx, 1810), (bx + (tx - bx) * .5, (1810 + ty) / 2 - 60), (tx, ty),
          w, col + (255,), (26, 96, 68, 230))
art.alpha_composite(plants)

# ---------------- 坐垫 ----------------
cish = Image.new("L", (S, S), 0)
ci = ImageDraw.Draw(cish)
ci.ellipse((380, 1382, 1670, 1768), fill=255)          # 底部（下垂感）
cush = Image.new("RGBA", (S, S), (211, 122, 150, 255))
cush.putalpha(cish)
art.alpha_composite(cush.filter(ImageFilter.GaussianBlur(2)))

top = mask_of(lambda d: d.ellipse((408, 1342, 1642, 1690), fill=255))
paint(art, top, (247, 176, 197, 255), (203, 112, 140, 255), ow=9, )
face = mask_of(lambda d: d.ellipse((452, 1370, 1598, 1650), fill=255))
paint(art, face, (255, 202, 216, 255), None)
gloss = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(gloss).ellipse((560, 1392, 1180, 1520), fill=(255, 235, 240, 150))
art.alpha_composite(gloss.filter(ImageFilter.GaussianBlur(34)))

# 靠垫缝线
ad = ImageDraw.Draw(art)
for i, (x0, x1) in enumerate([(700, 690), (900, 900), (1100, 1110)]):
    ad.arc((x0 - 260, 1372, x1 + 260, 1720), 250, 290, fill=(214, 132, 158, 120), width=7)
ad.arc((470, 1400, 1580, 1640), 185, 355, fill=(255, 230, 236, 90), width=8)

# 坐垫下阴影（贴地）
gs = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(gs).ellipse((430, 1660, 1620, 1810), fill=(90, 60, 40, 110))
art.alpha_composite(gs.filter(ImageFilter.GaussianBlur(40)))

# 角色层（含饭碗），稍后整体倾斜
ch = Image.new("RGBA", (S, S), (0, 0, 0, 0))
LINE = (22, 62, 100, 255)
BLUE_TOP = (108, 200, 252)
BLUE_BOT = (30, 94, 154)

# --- 尾鳍：两个旋转椭圆 + 根部 的并集 ---
tail_mask = mask_of(lambda d: (
    d.polygon([(int(x), int(y)) for x, y in ell_pts(1330, 1032, 66, 200)], fill=255),
    d.polygon([(int(x), int(y)) for x, y in ell_pts(1516, 894, 208, 104, -0.55)], fill=255),
    d.polygon([(int(x), int(y)) for x, y in ell_pts(1516, 1170, 208, 104, 0.55)], fill=255)))
tail_fill = vgrad((72, 158, 216), (25, 82, 134))
paint(ch, tail_mask, tail_fill, LINE, ow=12)
td = ImageDraw.Draw(ch)
for (p0, p1, p2) in [((1370, 980), (1450, 900), (1560, 800)),
                     ((1370, 1030), (1470, 1000), (1600, 940)),
                     ((1370, 1080), (1450, 1160), (1560, 1260))]:
    pts = [tuple(map(int, q)) for q in bezier(p0, p1, p2, 30)]
    td.line(pts, fill=(150, 214, 246, 130), width=9, joint="curve")

# --- 背鳍 ---
dorsal_mask = mask_of(lambda d: d.polygon(
    [(int(x), int(y)) for x, y in catmull([(1010, 690), (1052, 552), (1128, 528), (1214, 596), (1240, 692)])],
    fill=255))
paint(ch, dorsal_mask, vgrad((86, 172, 226), (36, 104, 164)), LINE, ow=11)

# --- 身体 ---
body_mask = mask_of(lambda d: d.ellipse((435, 570, 1365, 1450), fill=255))
paint(ch, body_mask, vgrad(BLUE_TOP, BLUE_BOT))
# 顶部高光
hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(hl).ellipse((520, 590, 1010, 1010), fill=(255, 255, 255, 120))
ch.alpha_composite(Image.composite(hl.filter(ImageFilter.GaussianBlur(75)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
# 底部暗面
dk = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(dk).ellipse((780, 1080, 1430, 1530), fill=(16, 56, 100, 105))
ch.alpha_composite(Image.composite(dk.filter(ImageFilter.GaussianBlur(75)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
# 头顶小斑点
spots = Image.new("RGBA", (S, S), (0, 0, 0, 0))
for cx, cy, r in [(690, 748, 60), (858, 706, 48), (1006, 742, 54)]:
    ImageDraw.Draw(spots).ellipse((cx - r, cy - r * .8, cx + r, cy + r * .8), fill=(190, 232, 255, 40))
ch.alpha_composite(Image.composite(spots.filter(ImageFilter.GaussianBlur(14)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
add_outline(ch, body_mask, LINE, 13)

# 肚皮
belly_mask = mask_of(lambda d: d.ellipse((540, 900, 1270, 1430), fill=255))
paint(ch, belly_mask, vgrad((228, 246, 255), (156, 212, 244)), None, soft_edge=26)
bd = ImageDraw.Draw(ch)
bd.arc((566, 930, 1246, 1416), 202, 338, fill=(255, 255, 255, 85), width=10)

# --- 眼睛 ---
def eye(cx, cy):
    d = ImageDraw.Draw(ch)
    d.ellipse((cx - 98, cy - 116, cx + 98, cy + 116), fill=(255, 255, 255, 255),
              outline=LINE, width=11)
    d.ellipse((cx - 84, cy - 104, cx + 84, cy + 102), fill=(15, 47, 82, 255))
    d.ellipse((cx - 84, cy - 104, cx + 84, cy - 6), fill=(26, 72, 116, 255))
    d.ellipse((cx - 66, cy - 92, cx + 30, cy - 4), fill=(255, 255, 255, 240))
    d.ellipse((cx - 74, cy - 98, cx - 34, cy - 52), fill=(255, 255, 255, 255))
    d.ellipse((cx + 32, cy + 40, cx + 62, cy + 72), fill=(206, 234, 255, 235))
    # 瞳孔里的星星（本鱼招牌）
    d.polygon(star4(cx - 26, cy + 26, 34, 0.22), fill=(255, 250, 220, 255))
    d.polygon(star4(cx - 26, cy + 26, 13, 0.3), fill=(255, 255, 255, 255))
    d.ellipse((cx - 98, cy - 116, cx + 98, cy + 116), outline=LINE, width=9)


eye(748, 912)
eye(1064, 912)

# --- 嘴 ω + 腮红 + 米粒 ---
md = ImageDraw.Draw(ch)
md.arc((850, 1052, 900, 1102), 0, 180, fill=LINE, width=11)
md.arc((900, 1052, 950, 1102), 0, 180, fill=LINE, width=11)
md.arc((872, 1072, 930, 1116), 20, 160, fill=(196, 122, 132, 170), width=7)

blush = Image.new("RGBA", (S, S), (0, 0, 0, 0))
blush.paste(Image.new("RGBA", (S, S), (247, 146, 170, 255)), (0, 0))
blush.putalpha(radial_alpha(628, 1058, 104, 1.9, 130))
ch.alpha_composite(blush)
blush2 = Image.new("RGBA", (S, S), (0, 0, 0, 0))
blush2.paste(Image.new("RGBA", (S, S), (247, 146, 170, 255)), (0, 0))
blush2.putalpha(radial_alpha(1176, 1058, 104, 1.9, 130))
ch.alpha_composite(blush2)

for cx, cy, r in [(852, 1128, 13), (880, 1112, 11), (826, 1112, 10), (866, 1148, 9)]:
    md.ellipse((cx - r, cy - r * 0.8, cx + r, cy + r * 0.8), fill=(255, 255, 255, 245),
               outline=(200, 184, 160, 210), width=3)

# ---------------- 饭碗 ----------------
bowl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
BOWL_LINE = (146, 176, 198, 255)

body_mask_bowl = ImageChops.multiply(
    mask_of(lambda d: d.ellipse((535, 1268, 935, 1592), fill=255)),
    mask_of(lambda d: d.rectangle((0, 1330, S, S), fill=255)))
paint(bowl, body_mask_bowl, vgrad((255, 255, 255), (203, 225, 240)), BOWL_LINE, ow=10)
# 碗身阴影
bw = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(bw).ellipse((640, 1400, 940, 1580), fill=(120, 160, 190, 65))
bowl.alpha_composite(Image.composite(bw.filter(ImageFilter.GaussianBlur(30)),
                                     Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask_bowl))
bwl = ImageDraw.Draw(bowl)
# 碗口
bwl.ellipse((535, 1268, 935, 1362), fill=(252, 254, 255, 255), outline=(116, 174, 212, 255), width=12)
bwl.ellipse((570, 1282, 900, 1350), fill=(255, 255, 255, 255))
# 蓝边环
bwl.arc((549, 1370, 921, 1436), 0, 180, fill=(112, 184, 226, 255), width=15)
bwl.arc((549, 1296, 921, 1350), 10, 170, fill=(122, 192, 230, 190), width=9)
# 高光
bwl.arc((575, 1290, 800, 1510), 100, 168, fill=(255, 255, 255, 210), width=13)
bwl.arc((612, 1300, 700, 1360), 200, 330, fill=(255, 255, 255, 240), width=9)

# 小鲸鱼印花
whale_body = catmull([(664, 1408), (676, 1378), (710, 1364), (752, 1362),
                      (788, 1372), (806, 1396), (782, 1420), (738, 1430), (696, 1422)])
bwl.polygon([(int(x), int(y)) for x, y in whale_body], fill=(44, 88, 122, 255))
bwl.polygon([(798, 1372), (844, 1344), (838, 1400)], fill=(44, 88, 122, 255))
bwl.polygon([(716, 1424), (706, 1444), (734, 1434)], fill=(44, 88, 122, 255))
bwl.ellipse((700, 1382, 714, 1396), fill=(255, 255, 255, 255))
# 鲸鱼喷水
for dx, dy in [(0, 0), (-16, 8), (16, 8)]:
    bwl.arc((718 + dx, 1326 + dy, 744 + dx, 1356 + dy), 200, 340, fill=(120, 178, 214, 255), width=5)

# --- 米饭 ---
rice = Image.new("RGBA", (S, S), (0, 0, 0, 0))
mound = catmull([(580, 1336), (586, 1256), (636, 1196), (724, 1170),
                 (812, 1200), (864, 1262), (870, 1338), (724, 1354)])
rice_mask = mask_of(lambda d: d.polygon([(int(x), int(y)) for x, y in mound], fill=255))
paint(rice, rice_mask, (252, 250, 244, 255), (198, 182, 158, 255), ow=8)
# 米粒粒粒分明
rd = ImageDraw.Draw(rice)
grains = [(622, 1274, 26), (664, 1232, 24), (714, 1206, 26), (764, 1200, 24),
          (814, 1228, 24), (846, 1274, 22), (630, 1320, 22), (688, 1296, 24),
          (742, 1284, 24), (796, 1296, 22), (700, 1258, 20), (752, 1248, 20)]
for cx, cy, r in grains:
    rd.ellipse((cx - r, cy - r * 0.78, cx + r, cy + r * 0.78), fill=(255, 255, 255, 255),
               outline=(216, 202, 180, 180), width=3)
    rd.arc((cx - r * .7, cy - r * .55, cx + r * .7, cy + r * .4), 200, 350,
           fill=(255, 255, 255, 255), width=4)
# 米饭阴影（贴碗处）
rsh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(rsh).ellipse((600, 1280, 850, 1360), fill=(176, 157, 128, 80))
rice.alpha_composite(Image.composite(rsh.filter(ImageFilter.GaussianBlur(20)),
                                     Image.new("RGBA", (S, S), (0, 0, 0, 0)), rice_mask))

ch.alpha_composite(bowl)
ch.alpha_composite(rice)

# --- 抱碗的两只小鳍 ---
def fin(points, rays):
    m = mask_of(lambda d: d.polygon([(int(x), int(y)) for x, y in catmull(points)], fill=255))
    paint(ch, m, vgrad((96, 194, 246), (40, 118, 176)), LINE, ow=11)
    d = ImageDraw.Draw(ch)
    for a, b, c in rays:
        d.line([tuple(map(int, q)) for q in bezier(a, b, c, 16)],
               fill=(158, 220, 250, 150), width=7)
    return m


fin([(1010, 1240), (952, 1258), (900, 1308), (872, 1370), (880, 1418),
     (946, 1424), (988, 1370), (1012, 1300)],
    [((960, 1276), (920, 1330), (906, 1402)),
     ((934, 1298), (898, 1352), (892, 1404))])
fin([(548, 1218), (596, 1244), (624, 1300), (628, 1362), (600, 1416),
     (548, 1402), (528, 1340), (524, 1268)],
    [((576, 1256), (600, 1312), (600, 1392)),
     ((600, 1276), (620, 1330), (614, 1396))])

# 热气（两缕）
for ox in (-40, 40):
    pts = bezier((700 + ox, 1160), (676 + ox, 1108), (706 + ox, 1060), 30)
    ImageDraw.Draw(ch).line([tuple(map(int, q)) for q in pts],
                            fill=(255, 255, 255, 90), width=12, joint="curve")

# 整体轻轻歪一点，摆烂感
ch = ch.rotate(5.5, center=(900, 1330), resample=Image.BICUBIC, expand=False)

# 角色投影（在坐垫上，画在角色下面）
csh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(csh).ellipse((640, 1400, 1320, 1560), fill=(150, 72, 96, 110))
art.alpha_composite(csh.filter(ImageFilter.GaussianBlur(45)))
art.alpha_composite(ch)

# ---------------- 点缀 ----------------
for cx, cy, r in [(392, 690, 40), (1252, 616, 34), (1368, 826, 25), (338, 928, 20),
                  (1288, 1010, 17), (508, 470, 15)]:
    sparkle(art, cx, cy, r, glow=70)

bub = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bubd = ImageDraw.Draw(bub)
for cx, cy, r in [(1650, 500, 27), (1746, 660, 17), (1520, 384, 14), (288, 520, 20),
                  (214, 900, 12), (1352, 1240, 11)]:
    bubd.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, 175), width=6)
    bubd.arc((cx - r * .6, cy - r * .75, cx + r * .5, cy + r * .18), 160, 300,
             fill=(255, 255, 255, 235), width=5)
art.alpha_composite(bub)

# 玻璃反光
glass = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glass)
gd.polygon([(180, 60), (420, 60), (120, 1500), (40, 1500)], fill=(255, 255, 255, 26))
gd.polygon([(1730, 60), (1870, 60), (1990, 900), (1940, 900)], fill=(255, 255, 255, 22))
art.alpha_composite(glass.filter(ImageFilter.GaussianBlur(16)))

# 暗角（只在边缘）
y, x = np.mgrid[0:S, 0:S]
d = np.sqrt((x - 1024) ** 2 + (y - 1024) ** 2) / 1420
va = np.clip((d - 0.52) / 0.5, 0, 1) ** 1.5 * 120
dark = Image.new("RGBA", (S, S), (8, 34, 60, 255))
dark.putalpha(Image.fromarray(va.astype(np.uint8), "L"))
art.alpha_composite(dark)

# ---------------- 装缸 ----------------
tank_mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(tank_mask).rounded_rectangle((56, 56, 1992, 1992), radius=80, fill=255)
canvas.paste(art, (0, 0), tank_mask)

fr = ImageDraw.Draw(canvas)
fr.rounded_rectangle((56, 56, 1992, 1992), radius=80, outline=(255, 255, 255, 240), width=28)
fr.rounded_rectangle((86, 86, 1962, 1962), radius=56, outline=(126, 196, 228, 150), width=7)
fr.rounded_rectangle((28, 28, 2020, 2020), radius=100, outline=(226, 194, 208, 130), width=7)
# 缸口高光
fr.arc((120, 110, 900, 700), 190, 250, fill=(255, 255, 255, 190), width=12)

out = canvas.convert("RGB").resize((OUT, OUT), Image.LANCZOS)
out.save("blue-fat-fish-selfie.png")
print("saved", out.size)
