import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDb, getSetting, setSetting } from './db'

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

export interface FileCategory {
  id: string
  name: string
  exts: string[]
  color: string
  builtin: boolean
  sortOrder: number
  count: number
}

export interface FileItem {
  id: string
  path: string
  name: string
  ext: string
  size: number
  mtime: number
  categoryId: string | null
  origPath: string
  state: string
  pinned: boolean
  missing: boolean
  addedAt: number
}

/* ------------------------------------------------------------------ */
/* 预设分类                                                            */
/* ------------------------------------------------------------------ */

export const PRESET_CATEGORIES: { id: string; name: string; exts: string; color: string }[] = [
  { id: 'doc', name: '文档', exts: 'doc,docx,pdf,txt,md,rtf,wps', color: 'blue' },
  { id: 'sheet', name: '表格', exts: 'xls,xlsx,csv,et', color: 'green' },
  { id: 'slide', name: '演示', exts: 'ppt,pptx,dps', color: 'orange' },
  { id: 'image', name: '图片', exts: 'png,jpg,jpeg,gif,bmp,webp,svg,ico,heic', color: 'pink' },
  { id: 'archive', name: '压缩包', exts: 'zip,rar,7z,tar,gz,bz2,xz', color: 'yellow' },
  { id: 'installer', name: '安装包', exts: 'exe,msi,appx,msix', color: 'red' }
]

const FALLBACK_ID = 'other'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

/** 收纳根目录：软件目录下的「收纳」，不可写时退回用户数据目录 */
export function storageRoot(): string {
  const exeDir = path.dirname(process.execPath)
  const candidate = path.join(exeDir, '收纳')
  try {
    fs.mkdirSync(candidate, { recursive: true })
    fs.accessSync(candidate, fs.constants.W_OK)
    return candidate
  } catch {
    const fallback = path.join(process.env.APPDATA || process.cwd(), '截图待办', '收纳')
    fs.mkdirSync(fallback, { recursive: true })
    return fallback
  }
}

/** 同名文件自动加 (1)(2) */
function uniquePath(dir: string, name: string): string {
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  let p = path.join(dir, name)
  let i = 1
  while (fs.existsSync(p)) {
    p = path.join(dir, `${base}(${i})${ext}`)
    i++
  }
  return p
}

/** 跨盘 rename 会报 EXDEV，退化成复制+删除 */
function safeMove(src: string, dst: string): boolean {
  try {
    fs.renameSync(src, dst)
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EXDEV') {
      try {
        fs.copyFileSync(src, dst)
        fs.unlinkSync(src)
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

/** 分类名转成安全的目录名 */
function safeDirName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '其他'
}

/** 首次运行时把预设分类写进去 */
export function ensurePresetCategories(): void {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) AS n FROM file_categories').get() as { n: number }
  if (row.n > 0) return

  const stmt = db.prepare(
    'INSERT INTO file_categories(id, name, exts, color, builtin, sort_order, created_at) VALUES(?,?,?,?,1,?,?)'
  )
  PRESET_CATEGORIES.forEach((c, i) => stmt.run(c.id, c.name, c.exts, c.color, i, now()))
  stmt.run(FALLBACK_ID, '其他', '', 'none', PRESET_CATEGORIES.length, now())
}

/* ------------------------------------------------------------------ */
/* 分类读写                                                            */
/* ------------------------------------------------------------------ */

function rowToCategory(r: any, counts: Map<string, number>): FileCategory {
  return {
    id: r.id,
    name: r.name,
    exts: r.exts ? String(r.exts).split(',').filter(Boolean) : [],
    color: r.color ?? 'none',
    builtin: !!r.builtin,
    sortOrder: r.sort_order ?? 0,
    count: counts.get(r.id) ?? 0
  }
}

export function listCategories(): FileCategory[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM file_categories ORDER BY sort_order ASC, created_at ASC')
    .all() as any[]
  const counts = new Map<string, number>()
  for (const c of db
    .prepare(
      "SELECT category_id, COUNT(*) AS n FROM files WHERE missing = 0 AND state = 'inbox' GROUP BY category_id"
    )
    .all() as any[]) {
    counts.set(c.category_id, c.n)
  }
  return rows.map((r) => rowToCategory(r, counts))
}

export function addCategory(name: string, exts: string[], color = 'none'): FileCategory {
  const db = getDb()
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM file_categories').get() as { m: number }
  const id = `c_${randomUUID().slice(0, 8)}`
  db.prepare(
    'INSERT INTO file_categories(id, name, exts, color, builtin, sort_order, created_at) VALUES(?,?,?,?,0,?,?)'
  ).run(id, name, exts.join(','), color, max.m + 1, now())
  return {
    id,
    name,
    exts,
    color,
    builtin: false,
    sortOrder: max.m + 1,
    count: 0
  }
}

export function renameCategory(id: string, name: string): void {
  getDb().prepare('UPDATE file_categories SET name = ? WHERE id = ?').run(name, id)
}

export function updateCategoryExts(id: string, exts: string[]): void {
  getDb().prepare('UPDATE file_categories SET exts = ? WHERE id = ?').run(exts.join(','), id)
}

/** 自定义分类可以删；删掉后它下面的文件落到「其他」 */
export function deleteCategory(id: string): boolean {
  const db = getDb()
  const row = db.prepare('SELECT builtin FROM file_categories WHERE id = ?').get(id) as
    | { builtin: number }
    | undefined
  if (!row || row.builtin) return false
  db.prepare('UPDATE files SET category_id = ? WHERE category_id = ?').run(FALLBACK_ID, id)
  db.prepare('DELETE FROM file_categories WHERE id = ?').run(id)
  return true
}

/** 按扩展名决定归到哪个分类：自建分类优先于预设，命中不了落到「其他」 */
function matchCategory(ext: string): string {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, exts FROM file_categories ORDER BY builtin ASC, sort_order ASC')
    .all() as { id: string; exts: string }[]
  const e = ext.toLowerCase()
  if (!e) return FALLBACK_ID
  for (const r of rows) {
    const list = r.exts ? r.exts.split(',').map((x) => x.trim().toLowerCase()) : []
    if (list.includes(e)) return r.id
  }
  return FALLBACK_ID
}

/* ------------------------------------------------------------------ */
/* 文件读写                                                            */
/* ------------------------------------------------------------------ */

function rowToFile(r: any): FileItem {
  return {
    id: r.id,
    path: r.path,
    name: r.name,
    ext: r.ext ?? '',
    size: r.size ?? 0,
    mtime: r.mtime ?? 0,
    categoryId: r.category_id ?? null,
    origPath: r.orig_path ?? '',
    state: r.state ?? 'inbox',
    pinned: !!r.pinned,
    missing: !!r.missing,
    addedAt: r.added_at
  }
}

export function listFiles(categoryId?: string | null): FileItem[] {
  const db = getDb()
  const sql = categoryId
    ? "SELECT * FROM files WHERE category_id = ? AND state = 'inbox' ORDER BY pinned DESC, added_at DESC"
    : "SELECT * FROM files WHERE state = 'inbox' ORDER BY pinned DESC, added_at DESC"
  const rows = (categoryId ? db.prepare(sql).all(categoryId) : db.prepare(sql).all()) as any[]
  return rows.map(rowToFile)
}

export function countFiles(): number {
  const r = getDb().prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }
  return r.n
}

/** 把一个磁盘文件登记进文件柜（只存路径，不移动、不复制） */
export function addFileByPath(absPath: string, categoryId?: string): FileItem | null {
  const db = getDb()
  let st: fs.Stats
  try {
    st = fs.statSync(absPath)
  } catch {
    return null
  }
  if (!st.isFile()) return null

  const name = path.basename(absPath)
  const ext = path.extname(name).replace(/^\./, '').toLowerCase()
  const existed = db.prepare('SELECT id, state FROM files WHERE orig_path = ?').get(absPath) as
    | { id: string; state: string }
    | undefined

  // 已经收进来过的，只是更新一下状态
  if (existed && existed.state === 'inbox') {
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(existed.id) as any
    return rowToFile(row)
  }

  const cat = categoryId ?? matchCategory(ext)
  const catRow = db.prepare('SELECT name FROM file_categories WHERE id = ?').get(cat) as
    | { name: string }
    | undefined
  const dstDir = path.join(storageRoot(), safeDirName(catRow?.name ?? '其他'))
  fs.mkdirSync(dstDir, { recursive: true })
  const dst = uniquePath(dstDir, name)

  // 真的把文件挪进收纳目录
  if (!safeMove(absPath, dst)) return null

  const id = existed ? existed.id : `f_${randomUUID().slice(0, 8)}`
  const dstStat = fs.statSync(dst)
  if (existed) {
    db.prepare(
      "UPDATE files SET path = ?, size = ?, mtime = ?, category_id = ?, state = 'inbox', missing = 0, moved_at = ?, last_seen = ? WHERE id = ?"
    ).run(dst, dstStat.size, Math.floor(dstStat.mtimeMs / 1000), cat, now(), now(), id)
  } else {
    db.prepare(
      "INSERT INTO files(id, path, orig_path, state, name, ext, size, mtime, category_id, added_at, moved_at, last_seen) VALUES(?,?,?,'inbox',?,?,?,?,?,?,?,?)"
    ).run(id, dst, absPath, name, ext, dstStat.size, Math.floor(dstStat.mtimeMs / 1000), cat, now(), now(), now())
  }
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any
  return rowToFile(row)
}

/** 把一个文件还原回它原来的位置 */
export function restoreOne(id: string): boolean {
  const db = getDb()
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any
  if (!row || row.state !== 'inbox') return false
  const orig = row.orig_path || ''
  if (!orig) return false
  if (!fs.existsSync(row.path)) return false

  try {
    fs.mkdirSync(path.dirname(orig), { recursive: true })
    const target = fs.existsSync(orig) ? uniquePath(path.dirname(orig), path.basename(orig)) : orig
    if (!safeMove(row.path, target)) return false
    db.prepare("UPDATE files SET path = ?, state = 'restored', missing = 0 WHERE id = ?").run(target, id)
    return true
  } catch {
    return false
  }
}

/** 关闭文件柜时把所有还收着的文件原样放回去 */
export function restoreAll(): { restored: number; failed: number } {
  const db = getDb()
  const rows = db.prepare("SELECT id FROM files WHERE state = 'inbox'").all() as { id: string }[]
  let restored = 0
  let failed = 0
  for (const r of rows) {
    if (restoreOne(r.id)) restored++
    else failed++
  }
  return { restored, failed }
}

export function removeFile(id: string): void {
  getDb().prepare('DELETE FROM files WHERE id = ?').run(id)
}

export function setFilePinned(id: string, pinned: boolean): void {
  getDb().prepare('UPDATE files SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
}

export function setFileCategory(id: string, categoryId: string): void {
  getDb().prepare('UPDATE files SET category_id = ? WHERE id = ?').run(categoryId, id)
}

/** 检查文件是否还在，标记失效；返回失效数量 */
export function refreshMissing(): number {
  const db = getDb()
  const rows = db.prepare('SELECT id, path FROM files').all() as { id: string; path: string }[]
  let missing = 0
  const upd = db.prepare('UPDATE files SET missing = ?, last_seen = ? WHERE id = ?')
  const t = now()
  for (const r of rows) {
    const exists = fs.existsSync(r.path)
    if (!exists) missing++
    upd.run(exists ? 0 : 1, t, r.id)
  }
  return missing
}

/* ------------------------------------------------------------------ */
/* 目录扫描                                                            */
/* ------------------------------------------------------------------ */

export function defaultWatchDirs(): string[] {
  const home = process.env.USERPROFILE || ''
  const out: string[] = []
  const desktop = path.join(home, 'Desktop')
  const publicDesktop = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')
  for (const d of [desktop, publicDesktop]) {
    if (fs.existsSync(d)) out.push(d)
  }
  return out
}

export function getWatchDirs(): string[] {
  const raw = getSetting('file_watch_dirs', '')
  if (!raw) return defaultWatchDirs()
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : defaultWatchDirs()
  } catch {
    return defaultWatchDirs()
  }
}

export function setWatchDirs(dirs: string[]): void {
  setSetting('file_watch_dirs', JSON.stringify(dirs))
}

export function getAutoScan(): boolean {
  return getSetting('file_auto_scan', '0') === '1'
}

export function setAutoScan(on: boolean): void {
  setSetting('file_auto_scan', on ? '1' : '0')
}

/** 扫一遍监听的目录（只看第一层，不递归），把新文件登记进来 */
export function scanDirs(): { added: number; scanned: number } {
  const db = getDb()
  const dirs = getWatchDirs()
  let added = 0
  let scanned = 0
  const seen = new Set<string>()

  for (const dir of dirs) {
    let names: string[] = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const n of names) {
      // 跳过隐藏文件、Office 临时文件、系统文件
      if (n.startsWith('.') || n.startsWith('~$')) continue
      const lower = n.toLowerCase()
      if (['desktop.ini', 'thumbs.db', 'ehthumbs.db', 'iconcache.db'].includes(lower)) continue
      const full = path.join(dir, n)
      let st: fs.Stats
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      scanned++
      seen.add(full)
      const exists = db
        .prepare('SELECT id FROM files WHERE path = ? OR orig_path = ?')
        .get(full, full) as { id: string } | undefined
      if (exists) continue
      // 扫描是「收纳」动作，会把文件搬进收纳目录
      if (addFileByPath(full)) added++
    }
  }
  return { added, scanned }
}
