"""
图标生成器：4 个方案，超采样 + 圆角/描边/渐变。
输出 build/candidates/*.png（256/64/32/20）和一张对比图。
"""
import zlib, struct, os, math

OUT = 'build/candidates'
SS = 4  # 超采样倍数


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def grad(c1, c2, x, y, size):
    return lerp(c1, c2, (x + y) / (2.0 * size))


class Img:
    def __init__(self, size):
        self.size = size
        self.px = bytearray(size * size * 4)

    def put(self, x, y, rgb, a=255):
        if 0 <= x < self.size and 0 <= y < self.size:
            i = (y * self.size + x) * 4
            self.px[i] = rgb[0]
            self.px[i + 1] = rgb[1]
            self.px[i + 2] = rgb[2]
            self.px[i + 3] = a

    def blend(self, x, y, rgb, alpha):
        if not (0 <= x < self.size and 0 <= y < self.size) or alpha <= 0:
            return
        i = (y * self.size + x) * 4
        a = min(1.0, alpha)
        old_a = self.px[i + 3] / 255.0
        na = a + old_a * (1 - a)
        if na <= 0:
            return
        for k in range(3):
            old = self.px[i + k]
            self.px[i + k] = int(round((rgb[k] * a + old * old_a * (1 - a)) / na))
        self.px[i + 3] = int(round(na * 255))

    def round_rect(self, x0, y0, x1, y1, r, colors, alpha=1.0, stroke=0):
        c1, c2 = colors
        for y in range(max(0, int(y0)), min(self.size, int(y1))):
            for x in range(max(0, int(x0)), min(self.size, int(x1))):
                cx = min(max(x, x0 + r), x1 - r)
                cy = min(max(y, y0 + r), y1 - r)
                d = math.hypot(x - cx, y - cy)
                if stroke > 0:
                    if abs(d - r) > stroke / 2:
                        continue
                    cover = min(1.0, max(0.0, (stroke / 2 - abs(d - r)) + 0.5))
                else:
                    if d > r:
                        continue
                    cover = min(1.0, max(0.0, (r - d) + 0.5))
                self.blend(x, y, grad(c1, c2, x, y, self.size), cover * alpha)

    def circle(self, cx, cy, r, color, alpha=1.0):
        for y in range(max(0, int(cy - r - 1)), min(self.size, int(cy + r + 2))):
            for x in range(max(0, int(cx - r - 1)), min(self.size, int(cx + r + 2))):
                d = math.hypot(x - cx, y - cy)
                cover = min(1.0, max(0.0, (r - d) + 0.5))
                self.blend(x, y, color, cover * alpha)

    def ring(self, cx, cy, r, w, color, alpha=1.0):
        for y in range(max(0, int(cy - r - w)), min(self.size, int(cy + r + w))):
            for x in range(max(0, int(cx - r - w)), min(self.size, int(cx + r + w))):
                d = math.hypot(x - cx, y - cy)
                cover = min(1.0, max(0.0, (w / 2 - abs(d - r)) + 0.5))
                self.blend(x, y, color, cover * alpha)

    def polyline(self, pts, w, color, alpha=1.0):
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            x0 = max(0, int(min(ax, bx) - w))
            x1 = min(self.size, int(max(ax, bx) + w) + 1)
            y0 = max(0, int(min(ay, by) - w))
            y1 = min(self.size, int(max(ay, by) + w) + 1)
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy or 1
            for y in range(y0, y1):
                for x in range(x0, x1):
                    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
                    d = math.hypot(x - (ax + t * dx), y - (ay + t * dy))
                    cover = min(1.0, max(0.0, (w / 2 - d) + 0.5))
                    self.blend(x, y, color, cover * alpha)

    def save(self, path):
        s = self.size
        raw = bytearray()
        for y in range(s):
            raw += b'\x00'
            raw += self.px[y * s * 4:(y + 1) * s * 4]

        def chunk(t, d):
            c = t + d
            return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

        ihdr = struct.pack('>IIBBBBB', s, s, 8, 6, 0, 0, 0)
        data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
                + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))
        open(path, 'wb').write(data)

    def downsample(self, factor):
        """按 alpha 加权把 block factor×factor 缩成一个像素（正确的降采样）"""
        s = self.size // factor
        out = Img(s)
        for y in range(s):
            for x in range(s):
                sa = 0.0
                pr = pg = pb = 0.0
                for sy in range(factor):
                    for sx in range(factor):
                        i = ((y * factor + sy) * self.size + (x * factor + sx)) * 4
                        pa = self.px[i + 3] / 255.0
                        pr += self.px[i] * pa
                        pg += self.px[i + 1] * pa
                        pb += self.px[i + 2] * pa
                        sa += pa
                n = factor * factor
                j = (y * s + x) * 4
                out.px[j + 3] = int(round((sa / n) * 255))
                if sa > 0:
                    out.px[j] = min(255, int(round(pr / sa)))
                    out.px[j + 1] = min(255, int(round(pg / sa)))
                    out.px[j + 2] = min(255, int(round(pb / sa)))
        return out


S = 256
BIG = S * SS
W = (255, 255, 255)


def base(colors, radius_ratio=0.225):
    img = Img(BIG)
    inset = 8 * SS
    r = BIG * radius_ratio
    img.round_rect(inset, inset, BIG - inset, BIG - inset, r, colors)
    return img


def draw_a():
    """A：渐变蓝底 + 四角取景框 + 中心勾"""
    img = base(((84, 124, 255), (47, 84, 232)))
    c = 58 * SS
    arm = 46 * SS
    w = 15 * SS
    for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        px = c if sx > 0 else BIG - c
        py = c if sy > 0 else BIG - c
        img.polyline([(px + sx * arm, py), (px, py), (px, py + sy * arm)], w, W, 0.92)
    img.polyline([(88 * SS, 132 * SS), (118 * SS, 162 * SS), (172 * SS, 100 * SS)], 21 * SS, W)
    return img


def draw_b():
    """B：渐变蓝底 + 相框 + 勾"""
    img = base(((92, 132, 255), (43, 78, 226)))
    img.round_rect(52 * SS, 66 * SS, 204 * SS, 190 * SS, 26 * SS, (W, W), 0.95, stroke=14 * SS)
    img.round_rect(96 * SS, 52 * SS, 148 * SS, 70 * SS, 8 * SS, (W, W), 0.95)
    img.polyline([(92 * SS, 138 * SS), (114 * SS, 160 * SS), (168 * SS, 100 * SS)], 18 * SS, W)
    return img


def draw_c():
    """C：青绿渐变 + 折角便签 + 勾"""
    img = base(((32, 196, 178), (12, 138, 128)))
    # 便签主体
    img.round_rect(58 * SS, 48 * SS, 198 * SS, 208 * SS, 22 * SS, (W, W), 0.96)
    # 折角（用底色三角遮盖）
    tri = [(160 * SS, 48 * SS), (198 * SS, 48 * SS), (198 * SS, 86 * SS)]
    for y in range(int(48 * SS), int(88 * SS)):
        for x in range(int(158 * SS), int(200 * SS)):
            # 判断在三角形右侧
            if (x - 160 * SS) + (y - 48 * SS) > 46 * SS:
                img.blend(x, y, (12, 138, 128), 1.0)
    img.polyline([(86 * SS, 140 * SS), (112 * SS, 166 * SS), (170 * SS, 104 * SS)], 20 * SS, (12, 138, 128))
    return img


def draw_d():
    """D：深灰紫渐变 + 极简勾 + 圆点"""
    img = base(((58, 62, 92), (28, 30, 46)))
    img.polyline([(76 * SS, 130 * SS), (112 * SS, 168 * SS), (184 * SS, 88 * SS)], 24 * SS, (124, 150, 255))
    img.circle(190 * SS, 66 * SS, 11 * SS, (124, 150, 255), 0.9)
    return img


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    makers = {'a': draw_a, 'b': draw_b, 'c': draw_c, 'd': draw_d}
    for key, fn in makers.items():
        big = fn()
        for size in (256, 64, 32, 20):
            factor = BIG // size
            big.downsample(factor).save(f'{OUT}/{key}-{size}.png')
        print('done', key)
