# -*- coding: utf-8 -*-
"""蓝色大肥鱼 · 鲸鱼娘 Q 版自画像（手绘代码版）
参考 B 站 DSH 大肥鱼桌宠封面：蓝渐变长发+呆毛、鲸鳍耳、白蕾丝女仆头饰、
海军蓝女仆裙+小鲸鱼围裙、鲸尾、星星眼。
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 2048
OUT = 1024

NAVY = (23, 34, 68, 255)
HAIR_TOP = (44, 54, 116)
HAIR_MID = (62, 108, 190)
HAIR_BOT = (132, 218, 248)
SKIN = (255, 233, 221)
SKIN_SH = (247, 206, 192)
DRESS = (28, 40, 84)
WHITE = (252, 253, 255)
BOW = (72, 140, 224)
PINK = (246, 152, 176)


def lerp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def grad_box(c1, c2, c3, w, h, stops=(0.0, 0.55, 1.0)):
    arr = np.zeros((h, w, 3), np.uint8)
    for i, t in enumerate(np.linspace(0, 1, h)):
        if t <= stops[1]:
            c = lerp(c1, c2, (t - stops[0]) / max(1e-6, stops[1] - stops[0]))
        else:
            c = lerp(c2, c3, (t - stops[1]) / max(1e-6, stops[2] - stops[1]))
        arr[i, :, :] = c
    return Image.fromarray(arr, "RGB")


def graded(mask, bbox, c1, c2, c3=None, stops=(0.0, 0.55, 1.0)):
    x0, y0, x1, y1 = bbox
    g = grad_box(c1, c2, c3 or c2, max(1, x1 - x0), max(1, y1 - y0), stops)
    lay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    lay.paste(g, (x0, y0))
    lay.putalpha(mask)
    return lay


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


def add_outline(layer, mask, color=NAVY, ow=12, blur=1.0):
    edge = ImageChops.subtract(mask, erode(mask, ow))
    if blur:
        edge = edge.filter(ImageFilter.GaussianBlur(blur))
    o = Image.new("RGBA", (S, S), color)
    o.putalpha(edge)
    layer.alpha_composite(o)


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


def sparkle(layer, cx, cy, r, color=(255, 246, 210), glow=80):
    if glow:
        g = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(g).polygon(seg(star4(cx, cy, r * 2.0, 0.15)), fill=color + (glow,))
        layer.alpha_composite(g.filter(ImageFilter.GaussianBlur(26)))
    d = ImageDraw.Draw(layer)
    d.polygon(seg(star4(cx, cy, r)), fill=color + (255,))
    d.polygon(seg(star4(cx, cy, r * 0.4)), fill=(255, 255, 255, 255))


def bezier(p0, p1, p2, n=40):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2 = map(np.array, (p0, p1, p2))
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2


# ---------------- 背景 ----------------
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(grad_box((246, 252, 255), (226, 243, 255), (208, 232, 252), S, S), (0, 0))
halo = Image.new("RGBA", (S, S), (255, 255, 255, 255))
halo.putalpha(radial(1024, 820, 760, 1.6, 150))
img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(90)))

# 地面软阴影
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(sh).ellipse((600, 1660, 1450, 1820), fill=(120, 150, 200, 95))
img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(45)))

ch = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# ---------------- 鲸尾（身后） ----------------
TAIL_BBOX = (1230, 1280, 1830, 1780)
tail = mask_of(lambda d: (
    d.polygon(seg(catmull([(1260, 1400), (1450, 1420), (1620, 1520),
                           (1700, 1460), (1780, 1520), (1660, 1600),
                           (1720, 1690), (1600, 1700), (1440, 1620), (1270, 1560)])), fill=255)))
ch.alpha_composite(graded(tail, TAIL_BBOX, (70, 120, 200), (38, 66, 132), (24, 40, 88)))
add_outline(ch, tail, NAVY, 12)

# ---------------- 后发 ----------------
HAIR_BACK = catmull([
    (1024, 380), (1220, 400), (1340, 500), (1390, 680), (1400, 900),
    (1420, 1150), (1440, 1400), (1420, 1560), (1330, 1620), (1240, 1540),
    (1150, 1600), (1040, 1540), (940, 1610), (850, 1545), (760, 1610),
    (690, 1540), (700, 1300), (690, 1050), (710, 830), (740, 640), (830, 450)])
hb_mask = mask_of(lambda d: d.polygon(seg(HAIR_BACK), fill=255))
ch.alpha_composite(graded(hb_mask, (690, 380, 1440, 1620), HAIR_TOP, HAIR_MID, HAIR_BOT,
                          (0.0, 0.5, 1.0)))
add_outline(ch, hb_mask, NAVY, 11)
# 发丝暗部
over_masked(ch, lambda d: [d.line([tuple(map(int, q)) for q in catmull(
    [(cx, 900), (cx + 20, 1200), (cx - 10, 1500)], 20)],
    fill=(18, 26, 60, 90), width=10, joint="curve")
    for cx in (820, 900, 1120, 1210)], hb_mask)
# 发丝亮部
over_masked(ch, lambda d: [d.line([tuple(map(int, q)) for q in catmull(
    [(cx, 700), (cx + 14, 980), (cx - 6, 1240)], 20)],
    fill=(196, 236, 255, 90), width=14, joint="curve")
    for cx in (760, 860, 990, 1160, 1300)], hb_mask)

# ---------------- 身体 ----------------
# 脖子
over(ch, lambda d: d.rounded_rectangle((968, 1024, 1082, 1132), 40, fill=SKIN + (255,)))

# 裙子（上身）
bodice = mask_of(lambda d: d.polygon(seg(catmull(
    [(800, 1108), (1024, 1086), (1248, 1108), (1292, 1300),
     (1260, 1338), (790, 1338), (756, 1300)])), fill=255))
ch.alpha_composite(graded(bodice, (756, 1086, 1292, 1340), (44, 60, 112), (26, 38, 80),
                          None, (0.0, 0.5, 1.0)))
add_outline(ch, bodice, NAVY, 12)

# 裙子（裙摆）
skirt = mask_of(lambda d: d.polygon(seg(catmull(
    [(772, 1308), (1276, 1308), (1352, 1480), (1400, 1660),
     (1250, 1712), (1024, 1690), (790, 1712), (648, 1660),
     (700, 1470)])), fill=255))
ch.alpha_composite(graded(skirt, (646, 1308, 1402, 1712), (38, 52, 100), (24, 34, 74),
                          None, (0.0, 0.5, 1.0)))
add_outline(ch, skirt, NAVY, 12)
# 裙摆褶
over_masked(ch, lambda d: [d.line([tuple(map(int, q)) for q in catmull(
    [(cx, 1348), (cx + dx, 1510), (cx + dx * 2, 1680)], 18)],
    fill=(70, 92, 156, 150), width=8, joint="curve")
    for cx, dx in [(850, -20), (940, -8), (1108, 8), (1198, 20)]], skirt)

# 裙摆白荷叶边
XS = list(range(660, 1400, 58))


def frill_y(x):
    return 1682 + int(14 * np.sin((x - 660) / 120))


frill = Image.new("RGBA", (S, S), (0, 0, 0, 0))
fd = ImageDraw.Draw(frill)
for x in XS:
    y = frill_y(x)
    fd.ellipse((x - 34, y - 30, x + 34, y + 34), fill=WHITE + (255,))
fd.rectangle((660, 1640, 1400, 1690), fill=WHITE + (255,))
fm = mask_of(lambda d: (d.rectangle((660, 1642, 1400, 1690), fill=255),
                        [d.ellipse((x - 34, frill_y(x) - 30, x + 34, frill_y(x) + 34), fill=255)
                         for x in XS]))
fm = ImageChops.multiply(fm, mask_of(lambda d: d.polygon(seg(catmull(
    [(640, 1400), (1420, 1400), (1470, 1760), (600, 1760)])), fill=255)))
ch.alpha_composite(frill)
add_outline(ch, fm, (150, 170, 205, 255), 7)

# 白色围裙
apron = mask_of(lambda d: d.rounded_rectangle((872, 1204, 1178, 1592), 44, fill=255))
ch.alpha_composite(graded(apron, (870, 1204, 1180, 1592), (255, 255, 255), (238, 246, 253),
                          None, (0.0, 0.5, 1.0)))
add_outline(ch, apron, (152, 174, 208, 255), 8)
# 围裙肩带
over(ch, lambda d: (d.line([(938, 1216), (956, 1102)], fill=WHITE + (255,), width=30),
                    d.line([(1112, 1216), (1092, 1102)], fill=WHITE + (255,), width=30)))

# 围裙小鲸鱼
whale = catmull([(988, 1392), (996, 1364), (1026, 1350), (1062, 1350),
                 (1094, 1360), (1110, 1382), (1090, 1404), (1052, 1413), (1012, 1406)])
over(ch, lambda d: (
    d.polygon(seg(whale), fill=(58, 122, 200, 255)),
    d.polygon(seg([(1104, 1362), (1144, 1336), (1140, 1390)]), fill=(58, 122, 200, 255)),
    d.polygon(seg([(1018, 1408), (1010, 1428), (1038, 1416)]), fill=(58, 122, 200, 255)),
    d.ellipse((1006, 1372, 1022, 1388), fill=(255, 255, 255, 255)),
    d.arc((1010, 1320, 1040, 1350), 200, 340, fill=(120, 176, 224, 255), width=5),
    d.arc((1046, 1316, 1072, 1346), 200, 340, fill=(120, 176, 224, 255), width=5)))

# 胸口蝴蝶结
def bow(cx, cy, w, h, color, dark):
    over(ch, lambda d: (
        d.polygon([(cx, cy), (cx - w, cy - h), (cx - w, cy + h)], fill=color + (255,)),
        d.polygon([(cx, cy), (cx + w, cy - h), (cx + w, cy + h)], fill=color + (255,)),
        d.polygon([(cx, cy - 6), (cx - w // 2, cy - h + 10), (cx - w // 2, cy + h - 10)],
                  fill=dark + (170,)),
        d.ellipse((cx - 26, cy - 26, cx + 26, cy + 26), fill=color + (255,),
                  outline=NAVY, width=6),
        d.ellipse((cx - 10, cy - 10, cx + 10, cy + 10), fill=(255, 250, 236, 255))))


bow(1024, 1152, 88, 64, BOW, (44, 96, 176))

# 白蕾丝领 + 泡泡袖
over(ch, lambda d: (d.ellipse((922, 1072, 1126, 1168), fill=WHITE + (255,),
                              outline=(150, 172, 206, 255), width=8)))
for sx in (768, 1280):
    over(ch, lambda d: (d.ellipse((sx - 72, 1108, sx + 72, 1264), fill=WHITE + (255,),
                                  outline=(150, 172, 206, 255), width=8),
                        d.arc((sx - 50, 1214, sx + 50, 1272), 200, 340,
                              fill=(196, 212, 236, 180), width=7)))

# ---------------- 脸 ----------------
face = mask_of(lambda d: d.ellipse((730, 530, 1320, 1112), fill=255))
ch.alpha_composite(graded(face, (730, 530, 1320, 1112), (255, 240, 230), SKIN, (250, 214, 200),
                          (0.0, 0.45, 1.0)))
# 下巴阴影
over_masked(ch, lambda d: d.ellipse((820, 980, 1230, 1180), fill=(238, 196, 182, 70)), face)
add_outline(ch, face, NAVY, 11)

# 腮红
for cx in (812, 1236):
    b = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    b.paste(Image.new("RGBA", (S, S), PINK + (255,)), (0, 0))
    b.putalpha(radial(cx, 930, 96, 1.9, 120))
    ch.alpha_composite(b)

# 眼睛
def eye(cx, cy):
    m = mask_of(lambda d: d.ellipse((cx - 88, cy - 100, cx + 88, cy + 100), fill=255))
    ch.alpha_composite(graded(m, (cx - 88, cy - 100, cx + 88, cy + 100),
                              (12, 30, 74), (40, 110, 196), (150, 226, 253), (0.0, 0.48, 1.0)))
    over_masked(ch, lambda d: d.ellipse((cx - 80, cy + 4, cx + 80, cy + 104),
                                        fill=(190, 240, 255, 110)), m)
    d = ImageDraw.Draw(ch)
    # 高光
    d.ellipse((cx - 62, cy - 78, cx - 6, cy - 18), fill=(255, 255, 255, 250))
    d.ellipse((cx - 52, cy - 68, cx - 20, cy - 34), fill=(255, 255, 255, 255))
    d.ellipse((cx + 30, cy + 44, cx + 54, cy + 68), fill=(255, 255, 255, 235))
    # 星星
    d.polygon(seg(star4(cx - 2, cy + 52, 24, 0.24)), fill=(255, 250, 220, 255))
    d.polygon(seg(star4(cx - 2, cy + 52, 9, 0.3)), fill=(255, 255, 255, 255))
    # 上眼线（粗）
    d.arc((cx - 92, cy - 108, cx + 92, cy + 96), 188, 352, fill=NAVY, width=18)
    add_outline(ch, m, NAVY, 9)


eye(902, 848)
eye(1146, 848)

# 眉（刘海下露一点）
over(ch, lambda d: (d.arc((856, 716, 946, 766), 200, 340, fill=(120, 96, 120, 160), width=9),
                    d.arc((1104, 716, 1194, 766), 200, 340, fill=(120, 96, 120, 160), width=9)))

# 嘴：张嘴笑
mouth_mask = mask_of(lambda d: d.pieslice((978, 940, 1070, 1010), 0, 180, fill=255))
m2 = Image.new("RGBA", (S, S), (108, 44, 62, 255))
m2.putalpha(mouth_mask)
ch.alpha_composite(m2)
add_outline(ch, mouth_mask, NAVY, 8)
tongue = mask_of(lambda d: d.ellipse((998, 976, 1052, 1012), fill=255))
tg = Image.new("RGBA", (S, S), PINK + (255,))
tg.putalpha(ImageChops.multiply(tongue, mouth_mask))
ch.alpha_composite(tg)

# 鼻子（小点）
over(ch, lambda d: d.ellipse((1016, 890, 1032, 906), fill=(226, 176, 166, 140)))

# ---------------- 鲸鳍耳 ----------------
def ear(sign):
    cx, cy = (706, 906) if sign < 0 else (1342, 906)
    d = -1 if sign < 0 else 1
    pts = catmull([(cx + d * 10, cy - 74), (cx + d * 92, cy - 100), (cx + d * 172, cy - 28),
                   (cx + d * 186, cy + 44), (cx + d * 136, cy + 72),
                   (cx + d * 70, cy + 38), (cx + d * 14, cy + 64)])
    m = mask_of(lambda dd: dd.polygon(seg(pts), fill=255))
    ch.alpha_composite(graded(m, (min(cx, cx + d * 205) - 10, cy - 120,
                                  max(cx, cx + d * 205) + 10, cy + 90),
                              (86, 140, 210), (32, 54, 112), None))
    add_outline(ch, m, NAVY, 11)
    inner = catmull([(cx + d * 40, cy - 34), (cx + d * 120, cy - 56),
                     (cx + d * 152, cy - 4), (cx + d * 108, cy + 30), (cx + d * 44, cy + 18)])
    over_masked(ch, lambda dd: dd.polygon(seg(inner), fill=(236, 248, 255, 200)), m)


ear(-1)
ear(1)

# ---------------- 刘海 ----------------
BANGS = catmull([
    (712, 646), (752, 512), (872, 452), (1024, 432), (1176, 452),
    (1292, 512), (1336, 646),
    (1298, 700), (1246, 690), (1192, 714), (1136, 690), (1078, 722),
    (1020, 692), (962, 720), (906, 690), (850, 716), (794, 688),
    (750, 706)])
b_mask = mask_of(lambda d: d.polygon(seg(BANGS), fill=255))
ch.alpha_composite(graded(b_mask, (700, 420, 1345, 815), (52, 64, 132), (66, 116, 198),
                          (120, 200, 244), (0.0, 0.55, 1.0)))
add_outline(ch, b_mask, NAVY, 10)
# 刘海发丝亮部
over_masked(ch, lambda d: [d.line([tuple(map(int, q)) for q in catmull(
    [(cx, 480), (cx - 10, 620), (cx - 18, 760)], 16)],
    fill=(186, 232, 255, 80), width=12, joint="curve")
    for cx in (800, 880, 960, 1120, 1200, 1270)], b_mask)

# ---------------- 呆毛 ----------------
ahoge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
pts = bezier((1006, 448), (960, 330), (1090, 268), 40)
wide = []
for i, p in enumerate(pts):
    w = 26 * (1 - i / len(pts)) + 6
    d = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
    L = np.hypot(*d) or 1
    nx, ny = -d[1] / L, d[0] / L
    wide.append((p[0] + nx * w, p[1] + ny * w))
for i, p in enumerate(pts[::-1]):
    w = 26 * (1 - (len(pts) - 1 - i) / len(pts)) + 6
    d = pts[min(len(pts) - 1 - i + 1, len(pts) - 1)] - pts[max(len(pts) - 1 - i - 1, 0)]
    L = np.hypot(*d) or 1
    nx, ny = -d[1] / L, d[0] / L
    wide.append((p[0] - nx * w, p[1] - ny * w))
am = mask_of(lambda d: d.polygon(seg(wide), fill=255))
ch.alpha_composite(graded(am, (900, 250, 1120, 460), (60, 76, 150), (90, 160, 226), None))
add_outline(ch, am, NAVY, 9)

# ---------------- 女仆头饰（贴着发顶的弧带 + 蕾丝边） ----------------
CXH, CYH, R_OUT, R_IN = 1024, 830, 396, 332


def ring_mask():
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    d.ellipse((CXH - R_OUT, CYH - R_OUT, CXH + R_OUT, CYH + R_OUT), fill=255)
    d.ellipse((CXH - R_IN, CYH - R_IN, CXH + R_IN, CYH + R_IN), fill=0)
    for deg in range(198, 344, 7):
        a = np.deg2rad(deg)
        cx = CXH + (R_OUT - 4) * np.cos(a)
        cy = CYH + (R_OUT - 4) * np.sin(a)
        d.ellipse((cx - 27, cy - 27, cx + 27, cy + 27), fill=255)
    return ImageChops.multiply(m, mask_of(lambda dd: dd.rectangle((0, 0, S, 812), fill=255)))


band = ring_mask()
ch.alpha_composite(graded(band, (CXH - R_OUT, CYH - R_OUT, CXH + R_OUT, 812),
                          (255, 255, 255), (236, 245, 253), None))
add_outline(ch, band, (124, 148, 188, 255), 8)
# 蕾丝褶皱
over_masked(ch, lambda d: [d.arc((cx - 24, cy - 24, cx + 24, cy + 24), 200, 340,
                                 fill=(202, 220, 240, 150), width=6)
                           for cx, cy in [(CXH + (R_OUT - 26) * np.cos(np.deg2rad(deg)),
                                           CYH + (R_OUT - 26) * np.sin(np.deg2rad(deg)))
                                          for deg in range(202, 342, 7)]], band)

# 两侧蝴蝶结
bow(650, 716, 50, 40, (86, 156, 232), (40, 96, 180))
bow(1398, 716, 50, 40, (86, 156, 232), (40, 96, 180))

# ---------------- 星星 ----------------
for cx, cy, r in [(420, 560, 34), (1600, 620, 30), (1680, 980, 20), (360, 1000, 18),
                  (1500, 1240, 14)]:
    sparkle(img, cx, cy, r, glow=60)

img.alpha_composite(ch)

out = img.convert("RGB").resize((OUT, OUT), Image.LANCZOS)
out.save("whale-girl-selfie.png")
print("saved", out.size)
