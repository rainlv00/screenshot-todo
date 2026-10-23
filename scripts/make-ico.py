"""把多尺寸 PNG 打包成 icon.ico（Vista+ 允许 ICO 内嵌 PNG）。"""
import struct, os

SIZES = [256, 64, 32, 20]
SRC = 'build/icon{}.png'
OUT = 'build/icon.ico'

images = []
for s in SIZES:
    p = SRC.format(s)
    if not os.path.exists(p):
        continue
    images.append((s, open(p, 'rb').read()))

n = len(images)
header = struct.pack('<HHH', 0, 1, n)

entries = b''
offset = 6 + 16 * n
payload = b''
for s, data in images:
    w = 0 if s >= 256 else s
    h = 0 if s >= 256 else s
    entries += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
    payload += data

open(OUT, 'wb').write(header + entries + payload)
print('ico ok:', OUT, os.path.getsize(OUT), 'bytes,', n, 'sizes')
