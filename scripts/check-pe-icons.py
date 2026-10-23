"""直接解析 PE 资源，看 exe 里到底嵌了什么图标。"""
import struct
import sys
import os
import zlib


def read_pe_icons(path):
    data = open(path, 'rb').read()
    e_lfanew = struct.unpack_from('<I', data, 0x3C)[0]
    if data[e_lfanew:e_lfanew + 4] != b'PE\0\0':
        raise SystemExit('不是 PE 文件')

    coff = e_lfanew + 4
    num_sections = struct.unpack_from('<H', data, coff + 2)[0]
    opt_size = struct.unpack_from('<H', data, coff + 16)[0]
    opt = coff + 20
    magic = struct.unpack_from('<H', data, opt)[0]
    dd_off = opt + (112 if magic == 0x20B else 96)
    res_rva, res_size = struct.unpack_from('<II', data, dd_off + 2 * 8)

    sections = []
    sec = opt + opt_size
    for i in range(num_sections):
        s = sec + i * 40
        vsize, vaddr, rsize, raddr = struct.unpack_from('<IIII', data, s + 8)
        sections.append((vaddr, max(vsize, rsize), raddr, rsize))

    def rva2off(rva):
        for vaddr, vsize, raddr, rsize in sections:
            if vaddr <= rva < vaddr + vsize:
                return raddr + (rva - vaddr)
        return None

    base = rva2off(res_rva)
    if base is None:
        raise SystemExit('找不到资源段')

    entries = {}  # (type, name) -> offset

    def walk(offset, level, path):
        chars, tds, maj, minr, n_named, n_id = struct.unpack_from('<IIHHHH', data, base + offset)
        p = base + offset + 16
        for i in range(n_named + n_id):
            name_field, data_field = struct.unpack_from('<II', data, p + i * 8)
            if name_field & 0x80000000:
                name = ('str', name_field & 0x7FFFFFFF)
            else:
                name = name_field & 0xFFFF
            if data_field & 0x80000000:
                walk(data_field & 0x7FFFFFFF, level + 1, path + [name])
            else:
                rva, size, cp, res = struct.unpack_from('<IIII', data, base + data_field)
                entries[tuple(path + [name])] = (rva, size)

    walk(0, 0, [])

    icons = []
    for key, (rva, size) in entries.items():
        if len(key) >= 2 and key[0] == 3:  # RT_ICON
            off = rva2off(rva)
            blob = data[off:off + size]
            is_png = blob[:8] == b'\x89PNG\r\n\x1a\n'
            if is_png:
                w, h = struct.unpack('>II', blob[16:24])
                kind = 'PNG'
            else:
                hdr = struct.unpack_from('<IiiHH', blob, 0)
                w, h2 = hdr[1], hdr[2]
                h = h2 // 2
                kind = 'BMP'
            icons.append((key[1], w, h, size, kind, blob))

    groups = [k for k in entries if k[0] == 14]  # RT_GROUP_ICON
    return icons, groups


def save_png(blob, path):
    """BMP(DIB) 转 PNG（仅 32bpp）"""
    w, h2, planes, bpp = struct.unpack_from('<iiHH', blob, 4)
    h = h2 // 2
    px_off = 40
    rows = []
    for y in range(h):
        src = px_off + (h - 1 - y) * w * 4
        row = blob[src:src + w * 4]
        out = bytearray()
        for x in range(w):
            b, g, r, a = row[x * 4:x * 4 + 4]
            out += bytes((r, g, b, a))
        rows.append(b'\x00' + bytes(out))
    raw = b''.join(rows)

    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))
    open(path, 'wb').write(png)


if __name__ == '__main__':
    exe = sys.argv[1]
    icons, groups = read_pe_icons(exe)
    print(f'文件: {os.path.basename(exe)}  ({os.path.getsize(exe) // 1024} KB)')
    print(f'图标资源数: {len(icons)}   图标组: {groups}')
    outdir = os.path.join(os.path.dirname(exe), '_iconcheck')
    os.makedirs(outdir, exist_ok=True)
    icons.sort(key=lambda t: -t[1])
    for idx, w, h, size, kind, blob in icons:
        name = f'{outdir}/icon-{w}x{h}-{kind}-{idx}.png'
        if kind == 'PNG':
            open(name, 'wb').write(blob)
        else:
            save_png(blob, name)
        print(f'  id={idx}  {w}x{h}  {kind}  {size} bytes -> {os.path.basename(name)}')
    print('导出到:', outdir)
