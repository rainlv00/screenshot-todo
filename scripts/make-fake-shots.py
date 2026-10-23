"""生成几张假的"截图"，用来测试界面。纯 stdlib，只画色块，不做文字渲染。"""
import zlib, struct, os, random, math

W, H = 760, 460


class Canvas:
    def __init__(self, w, h, bg=(255, 255, 255)):
        self.w, self.h = w, h
        self.buf = bytearray()
        row = bytes(bg) * w
        for _ in range(h):
            self.buf += row

    def _put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.buf[i] = c[0]
            self.buf[i + 1] = c[1]
            self.buf[i + 2] = c[2]

    def rect(self, x0, y0, x1, y1, c, r=0):
        x0, y0 = max(0, int(x0)), max(0, int(y0))
        x1, y1 = min(self.w, int(x1)), min(self.h, int(y1))
        if x1 <= x0 or y1 <= y0:
            return
        if r <= 0:
            span = bytes(c) * (x1 - x0)
            for y in range(y0, y1):
                i = (y * self.w + x0) * 3
                self.buf[i:i + len(span)] = span
            return
        for y in range(y0, y1):
            for x in range(x0, x1):
                cx = min(max(x, x0 + r), x1 - r)
                cy = min(max(y, y0 + r), y1 - r)
                if math.hypot(x - cx, y - cy) <= r:
                    self._put(x, y, c)

    def circle(self, cx, cy, rad, c):
        for y in range(int(cy - rad), int(cy + rad) + 1):
            dx = math.sqrt(max(0.0, rad * rad - (y - cy) ** 2))
            x0, x1 = int(cx - dx), int(cx + dx)
            if 0 <= y < self.h:
                x0, x1 = max(0, x0), min(self.w, x1)
                if x1 > x0:
                    span = bytes(c) * (x1 - x0)
                    i = (y * self.w + x0) * 3
                    self.buf[i:i + len(span)] = span

    def save(self, path):
        raw = bytearray()
        roww = self.w * 3
        for y in range(self.h):
            raw += b'\x00'
            raw += self.buf[y * roww:(y + 1) * roww]

        def chunk(t, d):
            c = t + d
            return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

        ihdr = struct.pack('>IIBBBBB', self.w, self.h, 8, 2, 0, 0, 0)
        out = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
               + chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b''))
        open(path, 'wb').write(out)


SCENES = [
    ('wechat', (7, 193, 96)),
    ('mail', (37, 99, 235)),
    ('ticket', (23, 43, 77)),
    ('error', (220, 38, 38)),
    ('sheet', (22, 163, 74)),
    ('doc', (124, 58, 237)),
]


def build(accent, seed):
    random.seed(seed)
    c = Canvas(W, H, (246, 247, 249))
    c.rect(22, 18, W - 22, H - 18, (255, 255, 255), 12)
    c.rect(22, 18, W - 22, 18 + 62, accent, 12)
    c.rect(22, 18 + 40, W - 22, 18 + 62, accent)
    c.circle(22 + 38, 18 + 31, 15, (255, 255, 255))
    c.rect(22 + 64, 18 + 20, 22 + 64 + random.randint(120, 210), 18 + 33, (255, 255, 255), 4)
    c.rect(22 + 64, 18 + 40, 22 + 64 + random.randint(80, 140), 18 + 47, (255, 255, 255), 3)

    y = 18 + 82
    for i in range(random.randint(4, 7)):
        w = random.randint(220, W - 110)
        color = (226, 229, 235) if i % 4 else (206, 211, 222)
        c.rect(46, y, 46 + w, y + 13, color, 5)
        y += 28

    y += 6
    c.rect(46, y, 46 + random.randint(240, 440), y + 16,
           tuple(min(255, int(v * 0.3 + 255 * 0.7)) for v in accent), 6)

    y += 36
    c.rect(46, y, 46 + 108, y + 32, accent, 8)
    c.rect(46 + 122, y, 46 + 122 + 88, y + 32, (233, 236, 242), 8)

    c.rect(W - 210, H - 62, W - 50, H - 50, (226, 229, 235), 5)
    return c


os.makedirs('/tmp/fake', exist_ok=True)
for i, (name, accent) in enumerate(SCENES):
    build(accent, 1000 + i).save(f'/tmp/fake/{i}-{name}.png')
print('generated', len(SCENES))
