import { type NativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const MAX_SIDE = 2560
const THUMB_WIDTH = 400

export interface SavedImage {
  id: string
  imagePath: string
  thumbPath: string
  hash: string
}

export function sha1(buf: Buffer): string {
  return crypto.createHash('sha1').update(buf).digest('hex')
}

/**
 * 落盘：主图长边压到 2560 的 JPEG(85)，另存宽 400 的缩略图。
 * 返回相对 data 目录的路径。
 */
export function saveImage(dataDir: string, srcBuffer: Buffer, srcImage: NativeImage): SavedImage {
  const id = crypto.randomUUID()
  const hash = sha1(srcBuffer)

  const { width, height } = srcImage.getSize()
  let main = srcImage
  const maxSide = Math.max(width, height)
  if (maxSide > MAX_SIDE) {
    const s = MAX_SIDE / maxSide
    main = srcImage.resize({
      width: Math.max(1, Math.round(width * s)),
      height: Math.max(1, Math.round(height * s)),
      quality: 'good'
    })
  }
  const mainBuf = main.toJPEG(85)

  let thumb = srcImage
  if (width > THUMB_WIDTH) {
    const s = THUMB_WIDTH / width
    thumb = srcImage.resize({
      width: THUMB_WIDTH,
      height: Math.max(1, Math.round(height * s)),
      quality: 'good'
    })
  }
  const thumbBuf = thumb.toJPEG(80)

  const imagePath = `images/${id}.jpg`
  const thumbPath = `thumbs/${id}.jpg`
  fs.writeFileSync(path.join(dataDir, imagePath), mainBuf)
  fs.writeFileSync(path.join(dataDir, thumbPath), thumbBuf)

  return { id, imagePath, thumbPath, hash }
}

export function deleteImageFiles(dataDir: string, rels: string[]): void {
  for (const rel of rels) {
    try {
      fs.unlinkSync(path.join(dataDir, rel))
    } catch {
      /* 忽略 */
    }
  }
}
