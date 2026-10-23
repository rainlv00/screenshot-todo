"""生成一张柔和的渐变壁纸，用于测试面板透明度/背景图。"""
import zlib, struct, os, math

W, H = 700, 450

# 三个色团，柔和混合
BLOBS = [
    (0.22, 0.28, 0.42, (86, 132, 255)),
    (0.78, 0.18, 0.36, (255, 158, 196)),
    (0.58, 0.82, 0.45, (120, 224, 205)),
]

rows = []
for y in range(H):
    row = bytearray()
    for x in range(W):
        fx, fy = x / W, y / H
        r = g = b = 0.0
        total = 0.0
        for bx, by, rad, (cr, cg, cb) in BLOBS:
            d = math.hypot(fx - bx, fy - by)
            w = max(0.0, 1.0 - d / rad) ** 2
            r += cr * w
            g += cg * w
            b += cb * w
            total += w
        if total > 0:
            r, g, b = r / total, g / total, b / total
            # 往白里压一点，显得干净
            r, g, b = r * 0.55 + 255 * 0.45, g * 0.55 + 255 * 0.45, b * 0.55 + 255 * 0.45
        else:
            r = g = b = 246
        row += bytes((int(r), int(g), int(b)))
    rows.append(bytes(row))

raw = bytearray()
for row in rows:
    raw += b'\x00'
    raw += row


def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)


ihdr = struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)
png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
       + chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b''))

os.makedirs('D:/tmp/fake', exist_ok=True)
open('D:/tmp/fake/wallpaper.png', 'wb').write(png)
print('wallpaper ok')
