"""把 release 目录打成 zip，方便发给同事。"""
import os, sys, zipfile, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'release', '截图待办-win32-x64')
VER = '1.0.0'
OUT = os.path.join(ROOT, 'release', f'截图待办-v{VER}-win64.zip')
ARC_TOP = f'截图待办-v{VER}'

if not os.path.isdir(SRC):
    print('缺少目录:', SRC)
    sys.exit(1)

if os.path.exists(OUT):
    os.remove(OUT)

files = []
for base, dirs, names in os.walk(SRC):
    for n in names:
        files.append(os.path.join(base, n))

total = sum(os.path.getsize(f) for f in files)
print(f'{len(files)} 个文件, 原始 {total/1024/1024:.1f} MB')

t0 = time.time()
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    # 空 data 目录也要保留
    z.writestr(ARC_TOP + '/data/', '')
    for i, f in enumerate(files, 1):
        rel = os.path.relpath(f, SRC).replace('\\', '/')
        z.write(f, f'{ARC_TOP}/{rel}')
        if i % 10 == 0:
            print(f'  {i}/{len(files)}', flush=True)

size = os.path.getsize(OUT)
print(f'完成: {OUT}')
print(f'压缩后 {size/1024/1024:.1f} MB, 耗时 {time.time()-t0:.0f}s')
