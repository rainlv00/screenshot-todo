// 把一张照片转成应用图标的多尺寸 PNG（居中裁正方形 + 缩放）
// 用法：electron scripts/make-icon-from-photo.js <图片路径>
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = process.argv.find((a) => a.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/))

app.whenReady().then(() => {
  if (!SRC || !fs.existsSync(SRC)) {
    console.error('找不到图片:', SRC)
    app.quit()
    return
  }

  const img = nativeImage.createFromPath(SRC)
  if (img.isEmpty()) {
    console.error('图片读不出来:', SRC)
    app.quit()
    return
  }

  const { width, height } = img.getSize()
  const side = Math.min(width, height)
  const square = img.crop({
    x: Math.round((width - side) / 2),
    y: Math.round((height - side) / 2),
    width: side,
    height: side
  })

  for (const size of [256, 64, 32, 20]) {
    const resized = square.resize({ width: size, height: size, quality: 'best' })
    const out = path.join(ROOT, 'build', `icon${size}.png`)
    fs.writeFileSync(out, resized.toPNG())
    console.log('写入', out)
  }

  // 应用内 LOGO 用 64
  fs.copyFileSync(path.join(ROOT, 'build', 'icon64.png'), path.join(ROOT, 'public', 'logo.png'))
  console.log('LOGO 已更新')
  app.quit()
})
