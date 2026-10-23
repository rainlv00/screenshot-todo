// 生成 Windows 兼容的 ICO（小尺寸用 BMP/DIB，不用 PNG 压缩）
// Windows 对小尺寸 PNG-in-ICO 支持不可靠，会导致图标显示成通用占位图。
// 用法：electron scripts/gen-ico.js <源图> <输出.ico> [背景色 #rrggbb]
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

const args = process.argv.filter((a) => !a.startsWith('--') && !a.endsWith('electron.exe'))
const src = process.argv.find((a) => a.toLowerCase().match(/\.(jpg|jpeg|png|webp|bmp)$/))
const out = path.resolve(__dirname, '..', 'build', 'icon.ico')

function dibFor(size, bgra) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // 高度翻倍：像素 + AND 掩码
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(size * size * 4, 20)
  header.writeInt32LE(0, 24)
  header.writeInt32LE(0, 28)
  header.writeUInt32LE(0, 32)
  header.writeUInt32LE(0, 36)

  // ICO 里的像素是自下而上
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4
    bgra.copy(pixels, y * size * 4, srcRow, srcRow + size * 4)
  }

  // AND 掩码：1bpp，每行补齐到 4 字节，全 0 表示不透明
  const maskRow = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRow * size, 0)

  return Buffer.concat([header, pixels, mask])
}

app.whenReady().then(() => {
  if (!src || !fs.existsSync(src)) {
    console.error('找不到源图:', src)
    app.quit()
    process.exit(1)
  }

  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) {
    console.error('源图读不出来:', src)
    app.quit()
    process.exit(1)
  }

  // 居中裁成正方形
  const { width, height } = img.getSize()
  const side = Math.min(width, height)
  const square = img.crop({
    x: Math.round((width - side) / 2),
    y: Math.round((height - side) / 2),
    width: side,
    height: side
  })

  const entries = []
  const blobs = []

  for (const size of SIZES) {
    const resized = square.resize({ width: size, height: size, quality: 'best' })
    const bgra = resized.toBitmap()
    // 照片不透明，alpha 均为 255，不需要处理预乘
    blobs.push(dibFor(size, bgra))
    // 同时导出一份 PNG 供托盘 / 界面使用
    fs.writeFileSync(path.join(__dirname, '..', 'build', `icon${size}.png`), resized.toPNG())
  }

  const count = SIZES.length
  const dir = Buffer.alloc(6 + count * 16)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(count, 4)

  let offset = 6 + count * 16
  SIZES.forEach((size, i) => {
    const base = 6 + i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, base)
    dir.writeUInt8(size >= 256 ? 0 : size, base + 1)
    dir.writeUInt8(0, base + 2)
    dir.writeUInt8(0, base + 3)
    dir.writeUInt16LE(1, base + 4)
    dir.writeUInt16LE(32, base + 6)
    dir.writeUInt32LE(blobs[i].length, base + 8)
    dir.writeUInt32LE(offset, base + 12)
    offset += blobs[i].length
  })

  fs.writeFileSync(out, Buffer.concat([dir, ...blobs]))
  console.log('ICO 已生成:', out, `(${SIZES.length} 个尺寸, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)

  // 界面 LOGO
  fs.copyFileSync(path.join(__dirname, '..', 'build', 'icon64.png'), path.join(__dirname, '..', 'public', 'logo.png'))
  app.quit()
})
