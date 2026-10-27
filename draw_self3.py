# -*- coding: utf-8 -*-
"""本鱼自画像 v3 —— 蓝色大肥鱼（DeepSeek 鲸鱼娘 mascot 版）。
参考社区形象：深蓝渐变、鲸耳鳍、鲸尾、白肚皮、鲸鱼碗、星星眼、没吃饱喵。
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont

S = 2048
OUT = 1024
FONT_B = "C:/Windows/Fonts/msyhbd.ttc"

# ---------- 调色 ----------
NAVY = (24, 36, 72, 255)
DEEP = (28, 54, 116)
BLUE = (58, 110, 196)
SKY = (108, 176, 242)
PALE = (176, 219, 250)
WHITE = (251, 253, 255)
CREAM = (255, 248, 238)
PINK = (244, 150, 172)

# ---------- 工具 ----------
def lerp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def vgrad3(c1, c2, c3, stops=(0.0, 0.55, 1.0), size=S):
    ys = np.linspace(0, 1, size)
    arr = np.zeros((size, size, 3), np.uint8)
    for i, t in enumerate(ys):
        if t <= stops[1]:
            k = (t - stops[0]) / (stops[1] - stops[0])
            c = lerp(c1, c2, k)
        else:
            k = (t - stops[1]) / (stops[2] - stops[1])
            c = lerp(c2, c3, k)
        arr[i, :, :] = c
    return Image.fromarray(arr, "RGB")


def radial(cx, cy, r, power=1.6, peak=255, size=S):
    y, x = np.mgrid[0:size, 0:size]
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


def seg(pts):
    return [(int(round(x)), int(round(y))) for x, y in pts]


def ell_pts(cx, cy, rx, ry, ang=0.0, n=140):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    u, v = rx * np.cos(t), ry * np.sin(t)
    ca, sa = np.cos(ang), np.sin(ang)
    return [(cx + a * ca - b * sa, cy + a * sa + b * ca) for a, b in zip(u, v)]


def mask_of(fn):
    m = Image.new("L", (S, S), 0)
    fn(ImageDraw.Draw(m))
    return m


def erode(mask, px, step=2):
    m = mask
    for _ in range(px):
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
    if soft:
        mask = mask.filter(ImageFilter.GaussianBlur(soft))
    if isinstance(fill, Image.Image):
        tmp = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        tmp.paste(fill.convert("RGB"), (0, 0), mask)
    else:
        tmp = Image.new("RGBA", (S, S), fill)
        tmp.putalpha(mask)
    layer.alpha_composite(tmp)
    if outline:
        add_outline(layer, mask if not soft else mask.point(lambda v: 255 if v > 110 else 0), outline, ow)


def star4(cx, cy, r, inner=0.20):
    pts = []
    for i in range(4):
        a = -np.pi / 2 + i * np.pi / 2
        pts.append((cx + r * np.cos(a), cy + r * np.sin(a)))
        b = a + np.pi / 4
        pts.append((cx + r * inner * np.cos(b), cy + r * inner * np.sin(b)))
    return pts


def sparkle(layer, cx, cy, r, color=(255, 246, 214), glow=90):
    if glow:
        g = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(g).polygon(seg(star4(cx, cy, r * 2.0, 0.15)), fill=color + (glow,))
        layer.alpha_composite(g.filter(ImageFilter.GaussianBlur(30)))
    d = ImageDraw.Draw(layer)
    d.polygon(seg(star4(cx, cy, r)), fill=color + (255,))
    d.polygon(seg(star4(cx, cy, r * 0.42)), fill=(255, 255, 255, 255))


# ---------- 画布 ----------
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(vgrad3((255, 253, 249), (255, 247, 237), (250, 241, 233)), (0, 0))

# 背景光晕
halo = Image.new("RGBA", (S, S), (0, 0, 0, 0))
halo.paste(Image.new("RGBA", (S, S), (205, 231, 252, 255)), (0, 0))
halo.putalpha(radial(1060, 1120, 830, 1.5, 205))
img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(70)))

# 背景小气泡/点
bd = ImageDraw.Draw(img)
rng = np.random.default_rng(5)
for _ in range(26):
    x, y = rng.integers(90, 1960), rng.integers(110, 1500)
    r = rng.integers(4, 12)
    bd.ellipse((x - r, y - r, x + r, y + r), fill=(120, 172, 220, 30))

# 地面阴影
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(sh).ellipse((500, 1690, 1620, 1860), fill=(120, 140, 180, 105))
img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(50)))

# ---------- 角色 ----------
ch = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 鲸尾（身后）
tail_mask = mask_of(lambda d: (
    d.polygon(seg(ell_pts(1520, 1560, 70, 120)), fill=255),
    d.polygon(seg(ell_pts(1640, 1490, 190, 72, -0.5)), fill=255),
    d.polygon(seg(ell_pts(1660, 1650, 190, 72, 0.55)), fill=255)))
paint(ch, tail_mask, vgrad3((84, 150, 218), (44, 88, 160), (26, 52, 108)), NAVY, 13)
td = ImageDraw.Draw(ch)
td.line(seg([(1560, 1520), (1620, 1470), (1690, 1440)]), fill=(150, 205, 245, 120), width=8, joint="curve")
td.line(seg([(1560, 1600), (1620, 1650), (1690, 1680)]), fill=(150, 205, 245, 90), width=8, joint="curve")

# 身体
body_mask = mask_of(lambda d: d.ellipse((500, 640, 1560, 1720), fill=255))
paint(ch, body_mask, vgrad3((132, 196, 248), (66, 124, 208), (34, 66, 140)))
# 顶部亮
hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(hl).ellipse((600, 660, 1100, 1080), fill=(255, 255, 255, 115))
ch.alpha_composite(Image.composite(hl.filter(ImageFilter.GaussianBlur(80)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
# 底部暗
dk = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(dk).ellipse((880, 1200, 1560, 1740), fill=(16, 40, 92, 95))
ch.alpha_composite(Image.composite(dk.filter(ImageFilter.GaussianBlur(80)),
                                   Image.new("RGBA", (S, S), (0, 0, 0, 0)), body_mask))
add_outline(ch, body_mask, NAVY, 15)

# 鲸耳鳍（左右）
def head_fin(sign):
    pts = ([(596, 980), (402, 900), (300, 946), (330, 1052), (520, 1120)]
           if sign < 0 else
           [(1464, 980), (1658, 900), (1760, 946), (1730, 1052), (1540, 1120)])
    m = mask_of(lambda d: d.polygon(seg(catmull(pts)), fill=255))
    paint(ch, m, vgrad3((92, 158, 228), (40, 82, 152), (26, 52, 108)), NAVY, 13)
    inner = catmull([(x + (60 if sign < 0 else -60), y + 6) for x, y in pts])
    ImageDraw.Draw(ch).polygon(seg(inner), fill=(150, 205, 250, 65))


head_fin(-1)
head_fin(1)

# 肚皮
belly_mask = mask_of(lambda d: (
    d.ellipse((680, 1120, 1380, 1700), fill=255)))
belly = Image.new("RGBA", (S, S), (0, 0, 0, 0))
belly.paste(vgrad3((255, 255, 255), (238, 248, 255), (208, 232, 250)), (0, 0))
bm = belly_mask.filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * 0.9))
belly.putalpha(bm)
ch.alpha_composite(belly)
bd2 = ImageDraw.Draw(ch)
# 鲸腹褶
for i, y in enumerate([1560, 1610, 1656]):
    w = 250 - i * 26
    bd2.arc((1060 - w, y - 40, 1060 + w, y + 40), 200, 340, fill=(120, 168, 214, 90), width=7)

# ---------- 脸 ----------
def eye(cx, cy, flip=1):
    d = ImageDraw.Draw(ch)
    # 眼白
    d.ellipse((cx - 112, cy - 132, cx + 112, cy + 132), fill=WHITE, outline=NAVY, width=12)
    iris_mask = mask_of(lambda dd: dd.ellipse((cx - 94, cy - 116, cx + 94, cy + 112), fill=255))
    iris = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    iris.paste(vgrad3((18, 32, 70), (44, 96, 172), (120, 200, 248)), (0, 0))
    iris.putalpha(iris_mask)
    ch.alpha_composite(iris)
    # 瞳孔 + 下方反光
    d.ellipse((cx - 44, cy - 74, cx + 40, cy + 18), fill=(12, 22, 52, 255))
    d.ellipse((cx - 74, cy + 30, cx + 70, cy + 104), fill=(128, 206, 250, 150))
    # 高光
    d.ellipse((cx - 78, cy - 108, cx + 10, cy - 22), fill=(255, 255, 255, 250))
    d.ellipse((cx - 62, cy - 96, cx - 8, cy - 46), fill=(255, 255, 255, 255))
    d.ellipse((cx + 34, cy + 40, cx + 68, cy + 76), fill=(255, 255, 255, 235))
    # 星星
    d.polygon(seg(star4(cx + 10, cy + 52, 26, 0.24)), fill=(255, 250, 226, 255))
    d.polygon(seg(star4(cx + 10, cy + 52, 10, 0.3)), fill=(255, 255, 255, 255))
    # 睫毛
    lx = cx + flip * 104
    ly = cy - 104
    d.line(seg([(lx, ly + 26), (lx + flip * 40, ly - 10)]), fill=NAVY, width=13, joint="curve")
    d.line(seg([(lx + 6, ly + 60), (lx + flip * 52, ly + 40)]), fill=NAVY, width=11, joint="curve")
    d.ellipse((cx - 112, cy - 132, cx + 112, cy + 132), outline=NAVY, width=9)


eye(872, 1082, -1)
eye(1196, 1082, 1)

# 腮红
for cx in (700, 1370):
    b = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    b.paste(Image.new("RGBA", (S, S), (247, 150, 172, 255)), (0, 0))
    b.putalpha(radial(cx, 1240, 118, 1.9, 120))
    ch.alpha_composite(b)

# 嘴：张嘴笑 + 舌头
mouth_mask = mask_of(lambda d: d.pieslice((982, 1244, 1098, 1348), 0, 180, fill=255))
paint(ch, mouth_mask, (112, 40, 58, 255), NAVY, 9)
tongue = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(tongue).ellipse((1006, 1288, 1076, 1340), fill=(244, 140, 160, 255))
tongue.putalpha(ImageChops.multiply(tongue.split()[3], mouth_mask))
ch.alpha_composite(tongue)

# 腮帮米粒
for cx, cy, r in [(1132, 1290, 12), (1158, 1274, 10), (1108, 1272, 9)]:
    bd2 = ImageDraw.Draw(ch)
    bd2.ellipse((cx - r, cy - r * .8, cx + r, cy + r * .8), fill=(255, 255, 255, 245),
                outline=(200, 184, 160, 210), width=3)

# ---------- 鲸鱼饭碗 ----------
bowl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
rim_y = 1478
b_mask = ImageChops.multiply(
    mask_of(lambda d: d.ellipse((720, rim_y - 70, 1320, 1840), fill=255)),
    mask_of(lambda d: d.rectangle((0, rim_y, S, S), fill=255)))
paint(bowl, b_mask, vgrad3((92, 138, 206), (44, 84, 158), (28, 54, 112)), NAVY, 11)
# 白肚
wb = mask_of(lambda d: d.ellipse((790, 1640, 1250, 1850), fill=255))
paint(bowl, wb, vgrad3((255, 255, 255), (226, 242, 252), (200, 226, 246)), None, soft=8)
add_outline(bowl, wb.point(lambda v: 255 if v > 110 else 0), NAVY, 8)

bd3 = ImageDraw.Draw(bowl)
# 碗口
bd3.ellipse((720, rim_y - 78, 1320, rim_y + 74), fill=(252, 254, 255, 255),
            outline=NAVY, width=12)
bd3.ellipse((770, rim_y - 54, 1270, rim_y + 46), fill=(255, 255, 255, 255))
# 鲸鱼眼睛 + 尾柄
bd3.ellipse((1156, 1592, 1196, 1632), fill=(255, 255, 255, 255))
bd3.ellipse((1168, 1604, 1186, 1622), fill=(24, 40, 80, 255))
bd3.polygon(seg([(760, 1520), (660, 1470), (668, 1560)]), fill=(44, 84, 158, 255))
bd3.polygon(seg([(760, 1586), (664, 1640), (700, 1568)]), fill=(44, 84, 158, 255))
bd3.arc((820, 1500, 960, 1580), 200, 340, fill=(255, 255, 255, 90), width=10)
bd3.arc((860, 1560, 1180, 1700), 200, 320, fill=(255, 255, 255, 55), width=14)

# 米饭
rice = Image.new("RGBA", (S, S), (0, 0, 0, 0))
mound = catmull([(766, 1490), (770, 1408), (826, 1348), (920, 1322),
                 (1046, 1320), (1150, 1348), (1218, 1412), (1236, 1490), (1000, 1520)])
rmask = mask_of(lambda d: d.polygon(seg(mound), fill=255))
paint(rice, rmask, (255, 255, 255, 255), (204, 190, 168, 255), 9)
rd = ImageDraw.Draw(rice)
grains = [(828, 1418, 30), (884, 1376, 28), (948, 1360, 30), (1016, 1358, 28),
          (1084, 1372, 28), (1146, 1404, 26), (1210, 1452, 24), (866, 1466, 26),
          (936, 1452, 28), (1010, 1450, 28), (1084, 1460, 26), (1150, 1488, 22)]
for cx, cy, r in grains:
    rd.ellipse((cx - r, cy - r * .76, cx + r, cy + r * .76), fill=(255, 255, 255, 255),
               outline=(216, 202, 180, 170), width=3)
    rd.arc((cx - r * .68, cy - r * .55, cx + r * .68, cy + r * .38), 195, 350,
           fill=(255, 255, 255, 255), width=4)
# 米饭底部阴影
rsh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(rsh).ellipse((820, 1440, 1180, 1520), fill=(176, 158, 130, 70))
rice.alpha_composite(Image.composite(rsh.filter(ImageFilter.GaussianBlur(18)),
                                     Image.new("RGBA", (S, S), (0, 0, 0, 0)), rmask))

ch.alpha_composite(bowl)
ch.alpha_composite(rice)

# ---------- 抱碗的小鳍 ----------
def hug_fin(pts, rays):
    m = mask_of(lambda d: d.polygon(seg(catmull(pts)), fill=255))
    paint(ch, m, vgrad3((132, 198, 248), (62, 118, 200), (34, 66, 140)), NAVY, 11)
    d = ImageDraw.Draw(ch)
    for a, b, c in rays:
        p = [tuple(map(int, q)) for q in catmull([a, b, c], 14)]
        d.line(p, fill=(176, 226, 252, 140), width=7, joint="curve")


hug_fin([(700, 1400), (760, 1418), (806, 1470), (812, 1546), (770, 1600),
         (706, 1572), (682, 1500), (684, 1436)],
        [((730, 1444), (764, 1502), (766, 1578)), ((760, 1452), (792, 1508), (786, 1566))])
hug_fin([(1400, 1400), (1340, 1418), (1298, 1470), (1294, 1546), (1336, 1600),
         (1400, 1572), (1424, 1500), (1420, 1436)],
        [((1372, 1444), (1338, 1502), (1336, 1578)), ((1342, 1452), (1310, 1508), (1316, 1566))])

# ---------- 喷水 ----------
sp = ImageDraw.Draw(ch)
for i, (dx, r) in enumerate([(-56, 15), (0, 19), (56, 15)]):
    sp.ellipse((1060 + dx - r, 592 - r, 1060 + dx + r, 592 + r),
               fill=(198, 234, 255, 255), outline=(120, 176, 220, 220), width=5)
    sp.ellipse((1060 + dx - r * .5, 592 - r * .8, 1060 + dx + r * .2, 592 - r * .2),
               fill=(255, 255, 255, 230))
for dx in (-1, 1):
    p = [tuple(map(int, q)) for q in catmull([(1060 + dx * 26, 700),
                                              (1030 + dx * 70, 660),
                                              (1060 + dx * 34, 616)], 18)]
    sp.line(p, fill=(178, 220, 250, 210), width=8, joint="curve")

img.alpha_composite(ch)

# ---------- 星星 ----------
for cx, cy, r in [(430, 620, 38), (1600, 560, 34), (1740, 980, 24), (350, 1080, 22),
                  (1520, 1180, 16), (620, 860, 14)]:
    sparkle(img, cx, cy, r, glow=70)

# ---------- 对话气泡 ----------
bub = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bd4 = ImageDraw.Draw(bub)
bd4.rounded_rectangle((128, 132, 986, 512), radius=66, fill=(255, 253, 248, 255),
                      outline=NAVY, width=12)
bd4.polygon(seg([(690, 498), (800, 640), (596, 512)]), fill=(255, 253, 248, 255),
            outline=NAVY)
# 盖住尾巴与气泡交界
bd4.rounded_rectangle((140, 140, 974, 500), radius=56, fill=(255, 253, 248, 255))
img.alpha_composite(bub)

f_big = ImageFont.truetype(FONT_B, 104, index=0)
f_small = ImageFont.truetype(FONT_B, 56, index=0)
dt = ImageDraw.Draw(img)

runs = [("还没吃饱", NAVY), ("喵", (226, 96, 128, 255)), ("！", NAVY)]
x = 186
for txt, col in runs:
    dt.text((x, 196), txt, font=f_big, fill=col)
    x += dt.textlength(txt, font=f_big)

dt.text((190, 372), "铲屎官，饭呢？", font=f_small, fill=(74, 88, 120, 255))

# 气泡上的小装饰
dt.line(seg([(170, 168), (300, 168)]), fill=(255, 210, 220, 220), width=8, joint="curve")

# ---------- 输出 ----------
out = img.convert("RGB").resize((OUT, OUT), Image.LANCZOS)
out.save("blue-fat-fish-selfie.png")
print("saved", out.size)
