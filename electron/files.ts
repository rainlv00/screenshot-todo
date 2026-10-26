import { app } from 'electron'
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
  /** 是否是文件夹（文件夹显示 --，不显示大小） */
  isDir?: boolean
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
  // 默认放在用户数据目录。
  // 绝不能用 exe 所在目录：程序目录会随版本升级、重装、打包被整体删掉，
  // 收纳里的文件会跟着一起没（这个坑已经真丢过一次文件）。
  const inDataDir = path.join(process.env.APPDATA || process.cwd(), '云笺', '收纳')
  try {
    fs.mkdirSync(inDataDir, { recursive: true })
    fs.accessSync(inDataDir, fs.constants.W_OK)
    return inDataDir
  } catch {
    const fallback = path.join(process.env.LOCALAPPDATA || process.cwd(), '云笺', '收纳')
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

/**
 * 判断一个文件该归到哪个分区。
 * 优先用「同名文件上次归到哪」——用户挪过一次，下次同名/同名不同版本自动跟着走；
 * 其次去掉扩展名和 (1)(2) 这类尾巴做前缀匹配；最后才按扩展名。
 */
function guessCategory(name: string, ext: string): string {
  const db = getDb()
  try {
    // 完全同名
    const same = db
      .prepare(
        'SELECT category_id FROM files WHERE name = ? AND category_id IS NOT NULL ORDER BY added_at DESC LIMIT 1'
      )
      .get(name) as { category_id: string } | undefined
    if (same?.category_id) return same.category_id

    // 去掉 扩展名 / (1) / 副本 等尾巴，比前缀
    const base = name
      .replace(/\.[^.]*$/, '')
      .replace(/\s*\((\d+)\)$/, '')
      .replace(/\s*-\s*副本$/, '')
      .trim()
    if (base.length >= 2) {
      const like = db
        .prepare(
          "SELECT category_id FROM files WHERE name LIKE ? AND category_id IS NOT NULL ORDER BY added_at DESC LIMIT 1"
        )
        .get(`${base}%`) as { category_id: string } | undefined
      if (like?.category_id) return like.category_id
    }
  } catch {
    /* 查不到就按扩展名 */
  }
  return matchCategory(ext)
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

/**
 * 删除分区。里面的文件先全部放回桌面，再删分类记录。
 * 内置分区不允许删（那是兜底用的）。
 */
export function deleteCategoryWithRestore(id: string): { restored: number; failed: number; ok: boolean } {
  const db = getDb()
  const row = db.prepare('SELECT builtin FROM file_categories WHERE id = ?').get(id) as
    | { builtin: number }
    | undefined
  if (!row) return { restored: 0, failed: 0, ok: false }
  if (row.builtin) return { restored: 0, failed: 0, ok: false }

  let restored = 0
  let failed = 0
  const items = db.prepare("SELECT id FROM files WHERE category_id = ? AND state = 'inbox'").all(id) as {
    id: string
  }[]
  for (const it of items) {
    if (restoreOne(it.id)) restored++
    else failed++
  }

  // 该分类下剩下的记录（已还原或本来就失效的）改挂到"其他"，避免悬空
  const other = db.prepare("SELECT id FROM file_categories WHERE id = 'other'").get() as
    | { id: string }
    | undefined
  if (other) {
    db.prepare('UPDATE files SET category_id = ? WHERE category_id = ?').run(other.id, id)
  }
  db.prepare('DELETE FROM file_categories WHERE id = ?').run(id)
  return { restored, failed, ok: true }
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
  // 文件夹也要能收进来（拖整个文件夹是最常见的操作）
  if (!st.isFile() && !st.isDirectory()) return null
  const isDir = st.isDirectory()

  const name = path.basename(absPath)
  const ext = path.extname(name).replace(/^\./, '').toLowerCase()
  const existed = db
    .prepare('SELECT id, state FROM files WHERE path = ? OR orig_path = ?')
    .get(absPath, absPath) as { id: string; state: string } | undefined

  // 已经收进来过的，只是更新一下状态
  if (existed && existed.state === 'inbox') {
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(existed.id) as any
    return rowToFile(row)
  }

  // 文件夹没有扩展名，直接归到「其他」，不参与同名/前缀匹配
  const cat = categoryId ?? (isDir ? 'other' : guessCategory(name, ext))
  const catRow = db.prepare('SELECT name FROM file_categories WHERE id = ?').get(cat) as
    | { name: string }
    | undefined
  const dstDir = path.join(storageRoot(), safeDirName(catRow?.name ?? '其他'))
  fs.mkdirSync(dstDir, { recursive: true })
  const dst = uniquePath(dstDir, name)

  // 真的把文件挪进收纳目录
  if (!safeMove(absPath, dst)) {
    archiveDebug(`safeMove 失败: ${absPath} -> ${dst}`)
    return null
  }

  const id = existed ? existed.id : `f_${randomUUID().slice(0, 8)}`
  const dstStat = fs.statSync(dst)
  try {
    if (existed) {
      db.prepare(
        "UPDATE files SET path = ?, orig_path = ?, size = ?, mtime = ?, category_id = ?, state = 'inbox', missing = 0, name = ?, ext = ?, moved_at = ?, last_seen = ? WHERE id = ?"
      ).run(dst, absPath, dstStat.size, Math.floor(dstStat.mtimeMs / 1000), cat, name, ext, now(), now(), id)
    } else {
      db.prepare(
        "INSERT INTO files(id, path, orig_path, state, name, ext, size, mtime, category_id, added_at, moved_at, last_seen) VALUES(?,?,?,'inbox',?,?,?,?,?,?,?,?)"
      ).run(id, dst, absPath, name, ext, dstStat.size, Math.floor(dstStat.mtimeMs / 1000), cat, now(), now(), now())
    }

    // 记录必须带上原路径，否则以后还原不了 —— 这里核对一遍，出问题就把文件搬回去
    const check = db.prepare('SELECT orig_path FROM files WHERE id = ?').get(id) as
      | { orig_path: string }
      | undefined
    if (!check || !check.orig_path) {
      archiveDebug(`写库校验失败 orig_path 为空，回滚: ${name}`)
      safeMove(dst, absPath)
      db.prepare('DELETE FROM files WHERE id = ?').run(id)
      return null
    }
  } catch {
    // 写库失败：文件也放回原处，绝不留在半路
    safeMove(dst, absPath)
    return null
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
  // app.getPath('desktop') 会处理 OneDrive 重定向、非中文系统等情况，
  // 自己拼 USERPROFILE\Desktop 在开了 OneDrive 备份的机器上会指到空目录
  const desktop = (() => {
    try {
      return app.getPath('desktop')
    } catch {
      return path.join(home, 'Desktop')
    }
  })()
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


/* ------------------------------------------------------------------ */
/* 桌面分区：只读扫描，不移动任何文件                                   */
/* ------------------------------------------------------------------ */

export interface DeskFile {
  name: string
  path: string
  ext: string
  size: number
  mtime: number
  /** 是不是文件夹 */
  dir: boolean
}

/** 扫描桌面并同步到库，state='desk' 表示"只是桌面分区展示"，文件没被移动 */
export interface DeskSyncResult {
  files: FileItem[]
  /** 这次新收录的文件，带上归属分区名，方便界面提示 */
  added: { name: string; category: string }[]
}

export function syncDeskFiles(): DeskSyncResult {
  const db = getDb()
  const raw = scanDesktopRaw()
  const alive = new Set(raw.map((f) => f.path))
  const added: { name: string; category: string }[] = []

  for (const f of raw) {
    const row = db.prepare('SELECT id FROM files WHERE path = ?').get(f.path) as { id: string } | undefined
    if (row) {
      db.prepare('UPDATE files SET size = ?, mtime = ?, missing = 0, last_seen = ? WHERE id = ?').run(
        f.size,
        f.mtime,
        now(),
        row.id
      )
    } else {
      const cat = matchCategory(f.ext)
      db.prepare(
        "INSERT INTO files(id, path, orig_path, state, name, ext, size, mtime, category_id, added_at, moved_at, last_seen) VALUES(?,?,'','desk',?,?,?,?,?,?,0,?)"
      ).run(`f_${randomUUID().slice(0, 8)}`, f.path, f.name, f.ext, f.size, f.mtime, cat, now(), now())
      added.push({ name: f.name, category: cat })
    }
  }

  // 桌面上消失的标记出来，不删记录（防止用户临时挪走又放回）
  const rows = db.prepare("SELECT id, path FROM files WHERE state = 'desk'").all() as {
    id: string
    path: string
  }[]
  for (const r of rows) {
    db.prepare('UPDATE files SET missing = ? WHERE id = ?').run(alive.has(r.path) ? 0 : 1, r.id)
  }

  const files = listDeskFiles()
  // 把分类 id 换成名字，界面直接用
  const catName = new Map<string, string>()
  for (const c of db.prepare('SELECT id, name FROM file_categories').all() as any[]) {
    catName.set(c.id, c.name)
  }
  return { files, added: added.map((a) => ({ name: a.name, category: catName.get(a.category) ?? '其他' })) }
}

export function listDeskFiles(): FileItem[] {
  const db = getDb()
  const rows = db
    .prepare("SELECT * FROM files WHERE state = 'desk' AND missing = 0 ORDER BY pinned DESC, added_at DESC")
    .all() as any[]
  return rows.map(rowToFile)
}

/** 读桌面上的文件/文件夹，按修改时间倒序。只读，绝不移动 */
function scanDesktopRaw(): DeskFile[] {
  const out: DeskFile[] = []
  const seen = new Set<string>()
  for (const dir of getWatchDirs()) {
    let names: string[] = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const n of names) {
      if (n.startsWith('.') || n.startsWith('~$')) continue
      const lower = n.toLowerCase()
      if (['desktop.ini', 'thumbs.db', 'ehthumbs.db', 'iconcache.db'].includes(lower)) continue
      const full = path.join(dir, n)
      if (seen.has(lower)) continue
      let st: fs.Stats
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      seen.add(lower)
      out.push({
        name: n,
        path: full,
        ext: path.extname(n).replace(/^\./, '').toLowerCase(),
        size: st.size,
        mtime: Math.floor(st.mtimeMs / 1000),
        dir: st.isDirectory()
      })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

/* ------------------------------------------------------------------ */
/* 分区2：搬运模式（把桌面文件真实移入收纳目录，可原样还原）            */
/* 与分区1 完全独立：分区1 只看不代表，分区2 才动文件                   */
/* ------------------------------------------------------------------ */

export interface ArchiveResult {
  /** 本次真正搬走的文件和它的归属分区 */
  moved: { name: string; category: string }[]
  /** 搬失败的文件名 */
  failed: string[]
  /** 桌面上扫到多少个文件 */
  scanned: number
}

/**
 * 生成一份可读的归档目录清单（收纳目录/归档目录.json）。
 * 记录「文件名 → 分区」，用户能直接打开看，也能手动改。
 * 归档时以数据库里的历史为准，这个文件是给人看的快照。
 */
function writeManifest(): void {
  try {
    const db = getDb()
    const cats = new Map<string, string>()
    for (const c of db.prepare('SELECT id, name FROM file_categories').all() as any[]) {
      cats.set(c.id, c.name)
    }
    const rows = db
      .prepare('SELECT name, category_id FROM files WHERE category_id IS NOT NULL ORDER BY name')
      .all() as { name: string; category_id: string }[]

    const byCat: Record<string, string[]> = {}
    for (const r of rows) {
      const cn = cats.get(r.category_id) ?? '其他'
      byCat[cn] = byCat[cn] ?? []
      if (!byCat[cn].includes(r.name)) byCat[cn].push(r.name)
    }

    const payload = {
      说明: '这是上一次归档的目录快照。同名文件下次会自动归到同一个分区。',
      更新时间: new Date().toLocaleString('zh-CN'),
      分项: byCat
    }
    const target = path.join(storageRoot(), '归档目录.json')
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf-8')
  } catch {
    /* 写不了清单不影响归档 */
  }
}

/** 把桌面上的文件全部搬进收纳目录，并按扩展名分好类 */
function archiveDebug(msg: string): void {
  try {
    const p = path.join(process.env.APPDATA || process.cwd(), '云笺', 'archive-debug.log')
    fs.appendFileSync(p, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* 日志写不了就算了 */
  }
}

export function archiveDesktop(): ArchiveResult {
  const raw = scanDesktopRaw()
  const db = getDb()
  const catName = new Map<string, string>()
  for (const c of db.prepare('SELECT id, name FROM file_categories').all() as any[]) {
    catName.set(c.id, c.name)
  }

  const moved: { name: string; category: string }[] = []
  const failed: string[] = []

  archiveDebug(`--- 开始归档，扫到 ${raw.length} 个文件，收纳根：${storageRoot()}`)
  for (const f of raw) {
    let item: FileItem | null = null
    try {
      item = addFileByPath(f.path)
    } catch (e) {
      archiveDebug(`异常 ${f.name}: ${e instanceof Error ? e.stack : String(e)}`)
      failed.push(f.name)
      continue
    }
    archiveDebug(`${f.name} -> ${item ? 'OK id=' + item.id : 'FAILED'}`)
    if (item) {
      moved.push({
        name: item.name,
        category: catName.get(item.categoryId ?? '') ?? '其他'
      })
    } else {
      failed.push(f.name)
    }
  }

  writeManifest()
  return { moved, failed, scanned: raw.length }
}

/**
 * 分区当前真正收着的文件。
 * 文件如果在外面被删/被移走，记录会一直停在 inbox 变成"幽灵条目"，
 * 界面上还显示着但点它毫无反应。这里顺手自愈：不存在就标成 restored + missing。
 */
export function listArchived(): FileItem[] {
  const db = getDb()
  const alive: FileItem[] = []
  for (const f of listFiles(null)) {
    let exists = false
    try {
      exists = fs.existsSync(f.path)
    } catch {
      exists = false
    }
    if (exists) {
      try {
        f.isDir = fs.statSync(f.path).isDirectory()
      } catch {
        /* 拿不到就当文件 */
      }
      alive.push(f)
    } else {
      db.prepare("UPDATE files SET state = 'restored', missing = 1 WHERE id = ?").run(f.id)
    }
  }
  return alive
}

/** 分区2 还有多少个文件没还原 */
export function archivePendingCount(): number {
  // 必须先走一次 listArchived 触发自愈，否则会把幽灵条目算进来
  return listArchived().length
}

/** 批量把指定路径的文件搬进收纳目录（拖拽收录用） */
export function addFilesByPaths(paths: string[]): {
  moved: { name: string; category: string }[]
  failed: string[]
} {
  const db = getDb()
  const catName = new Map<string, string>()
  for (const c of db.prepare('SELECT id, name FROM file_categories').all() as any[]) {
    catName.set(c.id, c.name)
  }

  const moved: { name: string; category: string }[] = []
  const failed: string[] = []

  for (const p of paths) {
    const item = addFileByPath(p)
    if (item) {
      moved.push({ name: item.name, category: catName.get(item.categoryId ?? '') ?? '其他' })
    } else {
      failed.push(path.basename(p))
    }
  }
  writeManifest()
  return { moved, failed }
}
