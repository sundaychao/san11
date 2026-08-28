from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


W, H = 1728, 2304
OUT = Path(r"C:\Users\Administrator\Pictures\68德州酒馆招聘海报_无水印.png")

FONT_TITLE = r"C:\Windows\Fonts\方正粗黑宋简体.ttf"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_REG = r"C:\Windows\Fonts\msyh.ttc"
FONT_KAI = r"C:\Windows\Fonts\simkai.ttf"
FONT_HEI = r"C:\Windows\Fonts\simhei.ttf"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt, stroke_width=0)
    return box[2] - box[0], box[3] - box[1]


def fit_font(draw: ImageDraw.ImageDraw, text: str, path: str, max_w: int, size: int, min_size: int = 18):
    while size > min_size:
        fnt = font(path, size)
        if text_size(draw, text, fnt)[0] <= max_w:
            return fnt
        size -= 2
    return font(path, min_size)


def draw_center(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.FreeTypeFont,
    fill,
    stroke_fill=None,
    stroke_width: int = 0,
):
    x, y = xy
    box = draw.textbbox((0, 0), text, font=fnt, stroke_width=stroke_width)
    tw, th = box[2] - box[0], box[3] - box[1]
    draw.text((x - tw / 2, y - th / 2), text, font=fnt, fill=fill, stroke_fill=stroke_fill, stroke_width=stroke_width)


def rounded_rectangle(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def add_noise(img: Image.Image, amount: int = 30, seed: int = 7):
    rng = random.Random(seed)
    pix = img.load()
    for _ in range(120000):
        x = rng.randrange(W)
        y = rng.randrange(H)
        r, g, b = pix[x, y]
        delta = rng.randrange(-amount, amount + 1)
        pix[x, y] = (
            max(0, min(255, r + delta)),
            max(0, min(255, g + delta)),
            max(0, min(255, b + delta)),
        )


def draw_wood_panel(draw: ImageDraw.ImageDraw, box, angle=0):
    x1, y1, x2, y2 = box
    rounded_rectangle(draw, box, 22, (58, 31, 13), (190, 125, 58), 8)
    rng = random.Random(x1 + y1 + x2 + y2)
    for y in range(y1 + 20, y2 - 20, 28):
        col = rng.choice([(92, 51, 22), (126, 75, 31), (37, 21, 11), (177, 112, 50)])
        draw.line((x1 + 20, y + rng.randint(-8, 8), x2 - 20, y + rng.randint(-8, 8)), fill=col, width=rng.randint(3, 8))
    for _ in range(70):
        x = rng.randint(x1 + 22, x2 - 22)
        y = rng.randint(y1 + 18, y2 - 18)
        draw.ellipse((x - 4, y - 2, x + 4, y + 2), fill=(25, 14, 8))
    draw.rectangle((x1 + 18, y1 + 18, x2 - 18, y2 - 18), outline=(235, 178, 93), width=3)


def draw_neon_text(base: Image.Image, pos, text, fnt, fill=(255, 80, 45), glow=(255, 40, 20), stroke=2):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text(pos, text, font=fnt, fill=(*glow, 220), stroke_width=stroke, stroke_fill=(*glow, 220))
    for radius, alpha in [(22, 80), (10, 120), (4, 180)]:
        blur = layer.filter(ImageFilter.GaussianBlur(radius))
        base.alpha_composite(Image.blend(Image.new("RGBA", base.size, (0, 0, 0, 0)), blur, alpha / 255))
    d = ImageDraw.Draw(base)
    d.text(pos, text, font=fnt, fill=fill, stroke_width=stroke, stroke_fill=(255, 240, 205, 230))


def draw_star(draw, cx, cy, r_outer, r_inner, fill, outline=None):
    pts = []
    for i in range(10):
        r = r_outer if i % 2 == 0 else r_inner
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    draw.polygon(pts, fill=fill, outline=outline)


def draw_icon_money(draw, box):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, 12, outline=(255, 238, 185), width=5)
    draw.rounded_rectangle((x1 + 45, y1 + 42, x2 - 45, y2 - 38), 24, fill=(255, 235, 174))
    draw.text((x1 + 83, y1 + 62), "$", font=font(FONT_BOLD, 58), fill=(45, 20, 7))
    draw.arc((x1 + 55, y1 + 16, x2 - 55, y1 + 78), 180, 360, fill=(255, 235, 174), width=12)


def draw_icon_gift(draw, box):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, 12, outline=(255, 238, 185), width=5)
    draw.rectangle((x1 + 48, y1 + 70, x2 - 48, y2 - 36), outline=(255, 238, 185), width=12)
    draw.line((x1 + 88, y1 + 50, x1 + 88, y2 - 36), fill=(255, 238, 185), width=10)
    draw.line((x1 + 42, y1 + 92, x2 - 42, y1 + 92), fill=(255, 238, 185), width=10)
    draw.arc((x1 + 38, y1 + 38, x1 + 92, y1 + 82), 180, 20, fill=(255, 238, 185), width=9)
    draw.arc((x1 + 82, y1 + 38, x1 + 140, y1 + 82), 160, 360, fill=(255, 238, 185), width=9)


def draw_icon_people(draw, box):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, 12, outline=(255, 238, 185), width=5)
    for cx, cy, rr in [(x1 + 70, y1 + 88, 24), (x1 + 112, y1 + 72, 28), (x1 + 154, y1 + 88, 24)]:
        draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=(255, 238, 185))
    draw.pieslice((x1 + 38, y1 + 112, x2 - 38, y2 - 26), 180, 360, fill=(255, 238, 185))


def draw_icon_chart(draw, box):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, 12, outline=(255, 238, 185), width=5)
    draw.line((x1 + 42, y2 - 44, x2 - 38, y2 - 44), fill=(255, 238, 185), width=7)
    draw.line((x1 + 44, y2 - 44, x1 + 44, y1 + 38), fill=(255, 238, 185), width=7)
    pts = [(x1 + 60, y2 - 68), (x1 + 96, y2 - 112), (x1 + 130, y2 - 96), (x1 + 176, y1 + 58)]
    draw.line(pts, fill=(255, 238, 185), width=12, joint="curve")
    draw.polygon([(x1 + 176, y1 + 58), (x1 + 145, y1 + 66), (x1 + 168, y1 + 91)], fill=(255, 238, 185))


def draw_job_beer(draw, x, y):
    draw.rounded_rectangle((x + 12, y + 5, x + 70, y + 92), 8, outline=(255, 238, 185), width=7)
    draw.arc((x + 58, y + 24, x + 100, y + 70), 270, 90, fill=(255, 238, 185), width=7)
    draw.ellipse((x + 24, y - 12, x + 58, y + 16), fill=(255, 238, 185))
    draw.ellipse((x + 45, y - 19, x + 82, y + 14), fill=(255, 238, 185))
    draw.line((x + 30, y + 20, x + 30, y + 80), fill=(255, 238, 185), width=4)
    draw.line((x + 50, y + 20, x + 50, y + 80), fill=(255, 238, 185), width=4)


def draw_job_martini(draw, x, y):
    draw.polygon([(x + 8, y + 4), (x + 100, y + 4), (x + 55, y + 64)], outline=(255, 238, 185), fill=None)
    draw.line((x + 55, y + 64, x + 55, y + 104), fill=(255, 238, 185), width=7)
    draw.line((x + 25, y + 104, x + 85, y + 104), fill=(255, 238, 185), width=7)
    draw.line((x + 68, y + 14, x + 98, y - 18), fill=(255, 238, 185), width=5)
    draw.ellipse((x + 95, y - 25, x + 114, y - 6), fill=(169, 39, 30))


def draw_job_cashier(draw, x, y):
    draw.rounded_rectangle((x + 14, y + 30, x + 92, y + 100), 8, outline=(255, 238, 185), width=7)
    draw.rectangle((x + 28, y + 4, x + 78, y + 32), fill=(255, 238, 185))
    draw.line((x + 30, y + 54, x + 78, y + 54), fill=(255, 238, 185), width=5)
    draw.line((x + 30, y + 75, x + 78, y + 75), fill=(255, 238, 185), width=5)


def main():
    random.seed(12)
    img = Image.new("RGB", (W, H), (10, 7, 5))
    pix = img.load()
    for y in range(H):
        for x in range(W):
            vignette = int(70 * ((x - W / 2) ** 2 / (W / 2) ** 2 + (y - H / 2) ** 2 / (H / 2) ** 2))
            warm = int(28 * (1 - y / H))
            pix[x, y] = (max(0, 22 + warm - vignette), max(0, 14 + warm // 2 - vignette), max(0, 9 - vignette // 2))
    add_noise(img, 14)
    img = img.convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Dark bar interior hints.
    for i in range(18):
        x = 40 + i * 94
        draw.rectangle((x, 540 + (i % 3) * 20, x + 38, 775), fill=(45, 24, 11, 120))
        draw.rectangle((x + 7, 515 + (i % 4) * 8, x + 31, 560), fill=(162, 100, 46, 120))
    for x in range(0, W, 120):
        draw.line((x, 0, x + 210, H), fill=(25, 16, 9, 70), width=3)

    # Top wooden sign.
    draw_wood_panel(draw, (70, 62, 1228, 530))
    draw.line((145, 0, 112, 90), fill=(153, 100, 55), width=13)
    draw.line((1165, 0, 1196, 95), fill=(153, 100, 55), width=13)
    draw.ellipse((90, 78, 135, 124), outline=(205, 154, 85), width=8)
    draw.ellipse((1174, 78, 1218, 124), outline=(205, 154, 85), width=8)

    draw.text((122, 150), "68", font=font(FONT_TITLE, 285), fill=(255, 242, 202), stroke_width=5, stroke_fill=(40, 18, 6))
    title_font = fit_font(draw, "德州酒馆", FONT_TITLE, 690, 170)
    draw.text((445, 150), "德州酒馆", font=title_font, fill=(255, 245, 215), stroke_width=4, stroke_fill=(40, 18, 6))
    draw_center(draw, (690, 424), "68 All in Club", font(FONT_BOLD, 62), (255, 238, 197), (36, 16, 7), 3)
    draw.line((460, 418, 535, 418), fill=(255, 238, 197), width=5)
    draw.line((900, 418, 982, 418), fill=(255, 238, 197), width=5)

    # Neon sign and horns.
    draw_neon_text(img, (1260, 86), "All-in", font(FONT_BOLD, 120), fill=(255, 98, 54), glow=(245, 42, 18), stroke=2)
    draw_neon_text(img, (1332, 230), "68", font(FONT_BOLD, 180), fill=(205, 235, 255), glow=(60, 150, 255), stroke=2)
    draw.arc((1340, 352, 1700, 625), 190, 345, fill=(188, 104, 43), width=24)
    draw.polygon([(1515, 442), (1582, 502), (1553, 636), (1484, 638), (1457, 502)], fill=(194, 128, 67), outline=(72, 35, 14))
    draw.ellipse((1480, 572, 1500, 594), fill=(44, 20, 8))
    draw.ellipse((1534, 572, 1554, 594), fill=(44, 20, 8))
    draw.line((1519, 456, 1519, 640), fill=(78, 37, 14), width=4)

    # Main headline.
    draw.text((70, 600), "招贤纳士", font=font(FONT_TITLE, 225), fill=(255, 241, 199), stroke_width=9, stroke_fill=(41, 17, 6))
    ribbon = [(70, 965), (915, 885), (965, 990), (110, 1070)]
    draw.polygon(ribbon, fill=(238, 186, 101), outline=(80, 38, 14))
    draw_center(draw, (505, 980), "★ 加入我们 共创精彩 ★", font(FONT_BOLD, 68), (99, 25, 20))
    draw_center(draw, (535, 1163), "★ 诚聘精英  虚位以待 ★", font(FONT_TITLE, 88), (255, 242, 198), (35, 15, 5), 4)

    # Benefits panel.
    rounded_rectangle(draw, (72, 1265, 972, 1648), 12, (17, 12, 8, 185), (210, 192, 160), 3)
    draw.rectangle((335, 1293, 720, 1368), fill=(229, 178, 91), outline=(77, 34, 12), width=4)
    draw_center(draw, (527, 1330), "★ 我们提供 ★", font(FONT_BOLD, 56), (52, 15, 9))
    icon_boxes = [(118, 1415, 255, 1556), (348, 1415, 485, 1556), (578, 1415, 715, 1556), (808, 1415, 945, 1556)]
    for fn, box in zip([draw_icon_money, draw_icon_gift, draw_icon_people, draw_icon_chart], icon_boxes):
        fn(draw, box)
    for cx, label in zip([186, 416, 646, 876], ["高薪待遇", "员工福利", "团队氛围", "晋升空间"]):
        draw_center(draw, (cx, 1601), label, font(FONT_BOLD, 36), (255, 238, 185))

    # Right chalkboard.
    board = (1012, 742, 1668, 1950)
    draw_wood_panel(draw, (982, 710, 1698, 1985))
    rounded_rectangle(draw, board, 8, (13, 26, 17), (67, 42, 23), 4)
    draw_center(draw, (1340, 845), "★ 招聘岗位 ★", font(FONT_TITLE, 74), (255, 246, 207), (30, 10, 5), 3)
    jobs = [
        (draw_job_beer, "服务员  六名", "薪资：4000-6000元"),
        (draw_job_martini, "调酒师  两名", "薪资：6000-10000元"),
        (draw_job_cashier, "收银员  两名", "薪资：3500-5000元"),
    ]
    y = 1022
    for icon_fn, role, salary in jobs:
        icon_fn(draw, 1086, y - 52)
        draw.text((1202, y - 58), role, font=fit_font(draw, role, FONT_TITLE, 410, 70), fill=(255, 246, 207), stroke_width=2, stroke_fill=(20, 8, 4))
        draw.text((1206, y + 28), salary, font=font(FONT_BOLD, 39), fill=(255, 238, 200))
        draw.line((1082, y + 132, 1608, y + 132), fill=(141, 72, 70), width=3)
        y += 260
    draw_center(draw, (1340, 1795), "★ 有经验者优先 ★", font(FONT_TITLE, 67), (255, 246, 207), (20, 8, 4), 3)

    # Foreground props.
    draw.ellipse((90, 1762, 630, 1906), fill=(73, 34, 13), outline=(196, 130, 62), width=8)
    draw.polygon([(200, 1728), (565, 1724), (465, 1835), (260, 1832)], fill=(111, 61, 28), outline=(206, 141, 75))
    draw.arc((205, 1664, 565, 1838), 190, 350, fill=(208, 141, 74), width=12)
    draw.line((185, 1746, 555, 1738), fill=(70, 36, 16), width=10)
    glass = [(735, 1682), (895, 1682), (865, 1892), (760, 1892)]
    draw.polygon(glass, outline=(220, 210, 188), fill=(125, 78, 34, 90))
    draw.rectangle((755, 1770, 875, 1880), fill=(187, 90, 21, 140))
    draw.arc((735, 1650, 895, 1710), 0, 360, fill=(240, 230, 204), width=6)
    for xx in [775, 815, 855]:
        draw.line((xx, 1688, xx + 25, 1888), fill=(235, 213, 172, 120), width=4)
    draw_star(draw, 982, 1802, 92, 39, (197, 176, 140), (36, 18, 9))
    draw.ellipse((930, 1750, 1035, 1854), outline=(46, 22, 10), width=8)
    draw_center(draw, (982, 1802), "68", font(FONT_BOLD, 34), (45, 21, 9))

    # Slogan and contact strip.
    draw.text((65, 1950), "这里有酒、有故事", font=font(FONT_KAI, 84), fill=(255, 233, 177), stroke_width=3, stroke_fill=(35, 12, 4))
    draw.text((158, 2053), "也有你的舞台！", font=font(FONT_KAI, 92), fill=(255, 233, 177), stroke_width=3, stroke_fill=(35, 12, 4))
    rounded_rectangle(draw, (1010, 1998, 1662, 2192), 14, (18, 10, 7, 220), (185, 175, 150), 3)
    draw_center(draw, (1336, 2056), "★ 加入68德州酒馆 ★", font(FONT_TITLE, 66), (255, 236, 196), (25, 9, 4), 3)
    draw_center(draw, (1336, 2138), "一起嗨翻全场！", font(FONT_KAI, 68), (255, 236, 196), (25, 9, 4), 3)

    rounded_rectangle(draw, (62, 2185, 1666, 2290), 14, (17, 12, 8, 225), (205, 193, 166), 4)
    draw.text((126, 2200), "●", font=font(FONT_BOLD, 55), fill=(255, 238, 185))
    address = "工作地点：68德州酒馆(广丰里)"
    phone = "联系电话：高总 19079342145"
    draw.text((202, 2199), address, font=fit_font(draw, address, FONT_BOLD, 575, 47), fill=(255, 238, 185))
    draw.line((805, 2196, 805, 2278), fill=(158, 139, 112), width=3)
    draw.arc((848, 2217, 895, 2265), 118, 238, fill=(255, 238, 185), width=11)
    draw.rectangle((844, 2246, 863, 2266), fill=(255, 238, 185))
    draw.rectangle((880, 2215, 899, 2235), fill=(255, 238, 185))
    draw.text((912, 2199), phone, font=fit_font(draw, phone, FONT_BOLD, 710, 47), fill=(255, 238, 185))

    # Warm vignette and sharpening.
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for i in range(40):
        od.rectangle((i * 8, i * 8, W - i * 8, H - i * 8), outline=(0, 0, 0, 5), width=9)
    img.alpha_composite(overlay)
    img = img.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1.2, percent=115, threshold=3))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, quality=96)
    print(OUT)


if __name__ == "__main__":
    main()
