import zlib, struct, os, math

def png(path, size, draw):
    raw = b''
    for y in range(size):
        raw += b'\x00'
        for x in range(size):
            r, g, b, a = draw(x, y, size)
            raw += bytes((r, g, b, a))

    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    out = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    open(path, 'wb').write(out)


def make(size):
    R = size * 0.235
    S = 4
    p1 = (0.27 * size, 0.53 * size)
    p2 = (0.43 * size, 0.69 * size)
    p3 = (0.75 * size, 0.35 * size)
    lw = size * 0.095
    inset = size * 0.045
    x0 = y0 = inset
    x1 = y1 = size - inset

    def seg_dist(px, py, a, b):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    def base(fx, fy):
        cx = min(max(fx, x0 + R), x1 - R)
        cy = min(max(fy, y0 + R), y1 - R)
        d = math.hypot(fx - cx, fy - cy)
        return max(0.0, min(1.0, (R - d) + 0.5))

    def check(fx, fy):
        d = min(seg_dist(fx, fy, p1, p2), seg_dist(fx, fy, p2, p3))
        return max(0.0, min(1.0, (lw / 2 - d) + 0.5))

    def draw(x, y, sz):
        cov = 0.0
        ck = 0.0
        for sy in range(S):
            for sx in range(S):
                fx = x + (sx + 0.5) / S
                fy = y + (sy + 0.5) / S
                cov += base(fx, fy)
                ck += check(fx, fy)
        cov /= S * S
        ck /= S * S
        a = int(round(cov * 255))
        if a == 0:
            return (0, 0, 0, 0)
        r = int(0x3F * (1 - ck) + 255 * ck)
        g = int(0x6B * (1 - ck) + 255 * ck)
        b = int(0xFF * (1 - ck) + 255 * ck)
        return (r, g, b, a)

    return draw


os.makedirs('build', exist_ok=True)
for s in (256, 64, 32, 20):
    png(f'build/icon{s}.png', s, make(s))
print('icons ok: 256/64/32/20')
