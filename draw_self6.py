# -*- coding: utf-8 -*-
"""本鱼自画像 v6 —— 蓝色大肥鱼 / DeepSeek 鲸鱼娘 mascot。
修正：局部渐变、按图形裁剪的高光、真正的对话气泡、碗形收口。
"""
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


def grad_box(c1, c2, c3, w, h, stops=(0.0, 0.5, 1.0)):
    arr = np.zeros((h, w, 3), np.uint8)
    for i, t in enumerate(np.linspace(0, 1, h)):
        if t <= stops[1]:
            c = lerp(c1, c2, (t - stops[0]) / max(1e-6, stops[1] - stops[0]))
        else:
            c = lerp(c2, c3, (t - stops[1]) / max(1e-6, stops[2] - stops[1]))
        arr[i, :, :] = c
    return Image.fromarray(arr, "RGB")


def graded(mask, bbox, c1, c2, c3=None, stops=(0.0, 0.5, 1.0)):
    x0, y0, x1, y1 = bbox
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    g = grad_box(c1, c2, c3 or c2, w, h, stops)
    lay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    lay.paste(g, (x0, y0))
    lay.putalpha(mask)
    return lay


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


def paint(layer, mask, fill, outline=None, ow=13):
    if isinstance(fill, Image.Image):
        tmp = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        tmp.paste(fill.convert("RGB"), (0, 0), mask)
    else:
        tmp = Image.new("RGBA", (S, S), fill)
        tmp.putalpha(mask)
    layer.alpha_composite(tmp)
    if outline:
        add_outline(layer, mask, outline, ow)


def over(layer, fn):
    t = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fn(ImageDraw.Draw(t))
    layer.alpha_composite(t)


def over_masked(layer, fn, mask):
    t = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fn(ImageDraw.Draw(t))
    t.putalpha(ImageChops.multiply(t.split()[3], mask))
    layer.alpha_composite(t)


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
img.paste(grad_box((255, 254, 250), (255, 247, 238), (250, 241, 233), S, S, (0, .55, 1)), (0, 0))

halo = Image.new("RGBA", (S, S), (208, 233, 252, 255))
halo.putalpha(radial(1040, 1080, 830, 1.5, 165))
img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(80)))

rng = np.random.default_rng(4)
dots = [(int(rng.integers(70, 1980)), int(rng.integers(110, 1600)), int(rng.integers(3, 9)))
        for _ in range(30)]
over(img, lambda d: [d.ellipse((x - r, y - r, x + r, y + r), fill=(108, 164, 214, 30))
                     for x, y, r in dots])
over(img, lambda d: [d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(150, 198, 238, 26))
                     for cx, cy, r in [(1760, 320, 110), (270, 1500, 130), (1840, 1260, 80)]])

sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(sh).ellipse((540, 1700, 1560, 1890), fill=(116, 136, 176, 110))
img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(55)))

# ---------------- 角色 ----------------
ch = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 鲸尾：正面视角收在身后，不画（露出来会像碗边的叶子）

# 头鳍（从身后伸出）
def head_fin(sign):
    cx, cy = (508, 962) if sign < 0 else (1556, 962)
    ang = -0.34 if sign < 0 else 0.34
    d = -1 if sign < 0 else 1
    base = ell_pts(cx, cy, 176, 76, ang)
    tri = [(cx + d * 40, cy - 62), (cx + d * 236, cy + 62), (cx + d * 40, cy + 66)]
    m = mask_of(lambda dd: (dd.polygon(seg(catmull(base + [tri[0]], 18, False)), fill=255),
                            dd.polygon(seg(tri), fill=255)))
    ch.alpha_composite(graded(m, (cx - 250, cy - 120, cx + 250, cy + 140),
                              (104, 170, 234), (44, 88, 160), (26, 50, 104)))
    add_outline(ch, m, NAVY, 13)
    over_masked(ch, lambda dd: dd.polygon(seg(ell_pts(cx - d * 30, cy - 16, 108, 24, ang)),
                                          fill=(176, 222, 252, 60)), m)


head_fin(-1)
head_fin(1)

# 身体
BODY_BBOX = (500, 600, 1580, 1680)
body_mask = mask_of(lambda d: d.ellipse((520, 620, 1560, 1660), fill=255))
ch.alpha_composite(graded(body_mask, BODY_BBOX, (152, 210, 250), (68, 128, 212), (28, 56, 126),
                          (0.0, 0.46, 1.0)))
hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(hl).ellipse((610, 640, 1070, 1070), fill=(255, 255, 255, 125))
ch.alpha_composite(Image.composite(hl.filter(ImageFilter.GaussianBlur(85)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
dk = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(dk).ellipse((900, 1180, 1590, 1690), fill=(14, 38, 88, 95))
ch.alpha_composite(Image.composite(dk.filter(ImageFilter.GaussianBlur(85)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
add_outline(ch, body_mask, NAVY, 15)

# 下巴附近的浅色反光（不做白肚，避免糊成胡子）
chin = Image.new("RGBA", (S, S), (0, 0, 0, 0))
chin.paste(Image.new("RGBA", (S, S), (222, 244, 255, 255)), (0, 0))
chin.putalpha(ImageChops.multiply(radial(1040, 1420, 300, 1.8, 120), body_mask))
ch.alpha_composite(chin.filter(ImageFilter.GaussianBlur(24)))

# ---------------- 脸 ----------------
def eye(cx, cy, flip):
    bbox = (cx - 106, cy - 112, cx + 106, cy + 112)
    m = mask_of(lambda d: d.ellipse(bbox, fill=255))
    ch.alpha_composite(graded(m, bbox, (12, 22, 52), (34, 92, 174), (172, 234, 255),
                              (0.0, 0.44, 1.0)))
    # 下方亮光
    over_masked(ch, lambda d: d.ellipse((cx - 104, cy + 2, cx + 104, cy + 124),
                                        fill=(196, 242, 255, 120)), m)
    d = ImageDraw.Draw(ch)
    # 大高光
    d.ellipse((cx - 66, cy - 82, cx + 4, cy - 12), fill=(255, 255, 255, 250))
    d.ellipse((cx - 58, cy - 76, cx - 18, cy - 34), fill=(255, 255, 255, 255))
    # 小高光
    d.ellipse((cx + 30, cy + 40, cx + 58, cy + 68), fill=(255, 255, 255, 240))
    # 星星
    d.polygon(seg(star4(cx - 4, cy + 52, 30, 0.23)), fill=(255, 250, 222, 255))
    d.polygon(seg(star4(cx - 4, cy + 52, 11, 0.3)), fill=(255, 255, 255, 255))
    add_outline(ch, m, NAVY, 11)
    ex = cx + flip * 100
    d.line([(ex, cy - 62), (ex + flip * 40, cy - 92)], fill=NAVY, width=12)
    d.line([(ex - flip * 2, cy - 30), (ex + flip * 42, cy - 42)], fill=NAVY, width=10)


eye(882, 1046, -1)
eye(1182, 1046, 1)

# 腮红
for cx in (742, 1322):
    b = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    b.paste(Image.new("RGBA", (S, S), (247, 148, 170, 255)), (0, 0))
    b.putalpha(radial(cx, 1206, 108, 1.9, 165))
    ch.alpha_composite(b)

# 嘴：开心张嘴
mouth_mask = mask_of(lambda d: d.pieslice((942, 1236, 1122, 1358), 0, 180, fill=255))
paint(ch, mouth_mask, (104, 34, 52, 255), NAVY, 9)
tongue = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(tongue).ellipse((988, 1298, 1076, 1360), fill=(246, 140, 160, 255))
tongue.putalpha(ImageChops.multiply(tongue.split()[3], mouth_mask))
ch.alpha_composite(tongue)

# 腮帮米粒（不画了，省得像胡子）

# ---------------- 饭碗 ----------------
bowl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
BOWL_LINE = (66, 100, 148, 255)
CX, RIM_Y, RIM_RX, RIM_RY = 1032, 1544, 322, 68
BOWL_BBOX = (690, 1460, 1374, 1876)

bowl_body = catmull([(716, 1508), (736, 1676), (806, 1816), (926, 1872),
                     (1138, 1872), (1258, 1816), (1328, 1676), (1348, 1508)])
body_mask_b = mask_of(lambda d: d.polygon(seg(bowl_body), fill=255))
bowl.alpha_composite(graded(body_mask_b, BOWL_BBOX, (255, 255, 255), (243, 249, 254), (201, 222, 242),
                            (0, .55, 1)))
add_outline(bowl, body_mask_b, BOWL_LINE, 11)

bwd = ImageDraw.Draw(bowl)
# 碗口内壁
bwd.ellipse((CX - RIM_RX, RIM_Y - RIM_RY, CX + RIM_RX, RIM_Y + RIM_RY),
            fill=(224, 240, 252, 255), outline=BOWL_LINE, width=11)
# 蓝纹
bwd.arc((CX - RIM_RX + 14, RIM_Y + 96, CX + RIM_RX - 14, RIM_Y + 196), 0, 180,
        fill=(84, 136, 196, 255), width=15)
bwd.arc((CX - RIM_RX + 26, RIM_Y - 46, CX + RIM_RX - 26, RIM_Y + 26), 14, 166,
        fill=(120, 176, 224, 140), width=8)
# 高光
bwd.arc((CX - 236, RIM_Y + 24, CX + 40, RIM_Y + 300), 100, 166, fill=(255, 255, 255, 235), width=14)
bwd.arc((CX - 176, RIM_Y + 40, CX - 40, RIM_Y + 112), 200, 330, fill=(255, 255, 255, 245), width=8)

# 鲸鱼印花
wb = catmull([(968, 1676), (976, 1644), (1008, 1628), (1046, 1628),
              (1080, 1640), (1096, 1662), (1074, 1684), (1034, 1694), (994, 1690)])
bwd.polygon(seg(wb), fill=(46, 82, 124, 255))
bwd.polygon(seg([(1090, 1640), (1132, 1610), (1128, 1666)]), fill=(46, 82, 124, 255))
bwd.polygon(seg([(1000, 1690), (992, 1712), (1022, 1698)]), fill=(46, 82, 124, 255))
bwd.ellipse((996, 1648, 1012, 1664), fill=(255, 255, 255, 255))
for dx, dy in [(0, 0), (-15, 9), (15, 9)]:
    bwd.arc((1000 + dx, 1588 + dy, 1028 + dx, 1620 + dy), 200, 340,
            fill=(116, 168, 212, 255), width=5)

# 碗内阴影
over(bowl, lambda d: d.ellipse((CX - RIM_RX + 14, RIM_Y - RIM_RY + 12,
                                CX + RIM_RX - 14, RIM_Y + RIM_RY - 8),
                               fill=(178, 204, 228, 210)))

# ---------------- 米饭 ----------------
rice = Image.new("RGBA", (S, S), (0, 0, 0, 0))
dome = catmull([(856, 1560), (862, 1496), (902, 1452), (958, 1432), (1040, 1428),
                (1122, 1434), (1178, 1464), (1214, 1506), (1220, 1560), (1038, 1578)])
bumps = [(884, 1470, 40), (944, 1442, 44), (1012, 1426, 46), (1082, 1430, 44),
         (1144, 1452, 40), (1190, 1492, 34)]
rmask = mask_of(lambda d: (d.polygon(seg(dome), fill=255),
                           [d.ellipse((cx - r, cy - r * .92, cx + r, cy + r * .92), fill=255)
                            for cx, cy, r in bumps]))
paint(rice, rmask, (255, 255, 255, 255), (204, 190, 166, 255), 7)
# 底部暖影
rsh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(rsh).ellipse((890, 1500, 1210, 1586), fill=(186, 168, 138, 70))
rice.alpha_composite(Image.composite(rsh.filter(ImageFilter.GaussianBlur(20)),
                                     Image.new("RGBA", (S, S), (0, 0, 0, 0)), rmask))
# 米粒起伏的阴影
over_masked(rice, lambda d: [d.arc((cx - 44, cy + 4, cx + 44, cy + 66), 205, 335,
                                   fill=(214, 200, 176, 90), width=6)
                             for cx, cy in [(912, 1452), (1000, 1436), (1090, 1442)]], rmask)
# 米粒
rd = ImageDraw.Draw(rice)
for cx, cy, r in [(892, 1508, 24), (950, 1490, 23), (1008, 1482, 24), (1066, 1482, 23),
                  (1120, 1494, 22), (1168, 1516, 20), (922, 1540, 20), (982, 1528, 21),
                  (1042, 1526, 21), (1098, 1534, 19)]:
    rd.ellipse((cx - r, cy - r * .72, cx + r, cy + r * .72), fill=(255, 255, 255, 255),
               outline=(218, 204, 180, 90), width=2)
    rd.arc((cx - r * .6, cy - r * .44, cx + r * .6, cy + r * .26), 195, 350,
           fill=(255, 255, 255, 255), width=4)
# 顶部高光
over_masked(rice, lambda d: d.ellipse((936, 1432, 1128, 1474), fill=(255, 255, 255, 210)), rmask)

ch.alpha_composite(bowl)
ch.alpha_composite(rice)
# 碗口前沿
over(ch, lambda d: (d.arc((CX - RIM_RX, RIM_Y - RIM_RY, CX + RIM_RX, RIM_Y + RIM_RY),
                          0, 180, fill=(250, 253, 255, 255), width=26),
                    d.arc((CX - RIM_RX, RIM_Y - RIM_RY, CX + RIM_RX, RIM_Y + RIM_RY),
                          2, 178, fill=BOWL_LINE, width=6)))

# ---------------- 抱碗小鳍 ----------------
def hug_fin(pts, rays):
    m = mask_of(lambda d: d.polygon(seg(catmull(pts)), fill=255))
    ch.alpha_composite(graded(m, (min(p[0] for p in pts), min(p[1] for p in pts),
                                max(p[0] for p in pts), max(p[1] for p in pts)),
                              (140, 204, 250), (62, 118, 200), (34, 66, 140)))
    add_outline(ch, m, NAVY, 11)
    over_masked(ch, lambda d: [d.line([tuple(map(int, q)) for q in catmull([a, b, c], 14)],
                                      fill=(190, 232, 252, 140), width=7, joint="curve")
                               for a, b, c in rays], m)


hug_fin([(772, 1420), (826, 1438), (864, 1492), (864, 1566), (824, 1620),
         (764, 1594), (744, 1524), (746, 1452)],
        [((800, 1462), (830, 1516), (830, 1592)), ((828, 1470), (856, 1524), (848, 1584))])
hug_fin([(1292, 1420), (1238, 1438), (1200, 1492), (1200, 1566), (1240, 1620),
         (1300, 1594), (1320, 1524), (1318, 1452)],
        [((1264, 1462), (1234, 1516), (1234, 1592)), ((1236, 1470), (1208, 1524), (1216, 1584))])

# ---------------- 喷水 ----------------
sp = ImageDraw.Draw(ch)
for dx, r in [(-58, 15), (0, 19), (58, 15)]:
    sp.ellipse((1050 + dx - r, 552 - r, 1050 + dx + r, 552 + r),
               fill=(202, 236, 255, 255), outline=(124, 180, 222, 225), width=5)
    sp.ellipse((1050 + dx - r * .55, 552 - r * .85, 1050 + dx + r * .15, 552 - r * .15),
               fill=(255, 255, 255, 235))
for dx in (-1, 1):
    sp.line([tuple(map(int, q)) for q in catmull([(1050 + dx * 22, 646),
                                                  (1018 + dx * 60, 612),
                                                  (1050 + dx * 28, 576)], 16)],
            fill=(184, 226, 250, 205), width=8, joint="curve")

img.alpha_composite(ch)

# ---------------- 星星 ----------------
for cx, cy, r in [(404, 596, 38), (1642, 522, 32), (1782, 940, 24), (326, 1064, 20),
                  (1566, 1146, 16), (622, 826, 14)]:
    sparkle(img, cx, cy, r, glow=70)

# ---------------- 气泡（整体轮廓） ----------------
bub_mask = mask_of(lambda d: (d.rounded_rectangle((118, 120, 984, 484), radius=64, fill=255),
                              d.polygon(seg([(596, 440), (738, 648), (770, 436)]), fill=255)))
bshadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bshadow.paste(Image.new("RGBA", (S, S), (60, 70, 100, 60)), (0, 0))
bshadow.putalpha(bub_mask)
img.alpha_composite(bshadow.transform((S, S), Image.AFFINE, (1, 0, -6, 0, 1, -8),
                                      resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(14)))
paint(img, bub_mask, PAPER, NAVY, 12)
over(img, lambda d: d.line(seg([(174, 168), (318, 168)]), fill=(255, 206, 218, 230),
                           width=8, joint="curve"))

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
print("saved", out.size)
