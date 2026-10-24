import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import type { Prefs, Task } from '../shared/types'

let db: DatabaseSync
let dataRoot = ''

const now = () => Math.floor(Date.now() / 1000)

function daysHeldFrom(createdAt: number): number {
  const a = new Date(createdAt * 1000)
  a.setHours(0, 0, 0, 0)
  const b = new Date()
  b.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000))
}

function rowToTask(r: any): Task {
  return {
    id: r.id,
    title: r.title ?? '',
    imagePath: r.image_path,
    thumbPath: r.thumb_path,
    dueAt: r.due_at ?? null,
    status: r.status,
    source: r.source,
    reopenCount: r.reopen_count ?? 0,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? null,
    pinned: !!r.pinned,
    color: (r.color ?? 'none') as Task['color'],
    sortOrder: r.sort_order ?? 0,
    daysHeld: daysHeldFrom(r.created_at)
  }
}

export function initDb(dataDir: string): void {
  dataRoot = dataDir
  fs.mkdirSync(path.join(dataDir, 'images'), { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'thumbs'), { recursive: true })
  db = new DatabaseSync(path.join(dataDir, 'tasks.db'))

  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL DEFAULT '',
      image_path   TEXT NOT NULL,
      thumb_path   TEXT NOT NULL,
      img_hash     TEXT NOT NULL,
      due_at       INTEGER,
      status       TEXT NOT NULL DEFAULT 'pending',
      source       TEXT NOT NULL DEFAULT 'clipboard',
      reopen_count INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      completed_at INTEGER,
      deleted_at   INTEGER,
      pinned       INTEGER NOT NULL DEFAULT 0,
      color        TEXT NOT NULL DEFAULT 'none',
      sort_order   INTEGER NOT NULL DEFAULT 0
    );
  `)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_hash ON tasks(img_hash)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_status_created ON tasks(status, created_at DESC)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_status_completed ON tasks(status, completed_at DESC)')

  // 老库自动补列
  const cols = db.prepare('PRAGMA table_info(tasks)').all() as any[]
  const has = (n: string) => cols.some((c) => c.name === n)
  if (!has('deleted_at')) db.exec('ALTER TABLE tasks ADD COLUMN deleted_at INTEGER')
  if (!has('pinned')) db.exec('ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
  if (!has('color')) db.exec("ALTER TABLE tasks ADD COLUMN color TEXT NOT NULL DEFAULT 'none'")
  if (!has('sort_order')) db.exec('ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      action  TEXT NOT NULL,
      at      INTEGER NOT NULL
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id, at DESC)')

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // ---- 文件柜 ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_categories (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      exts       TEXT NOT NULL DEFAULT '',
      color      TEXT NOT NULL DEFAULT 'none',
      builtin    INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id          TEXT PRIMARY KEY,
      path        TEXT NOT NULL UNIQUE,
      orig_path   TEXT NOT NULL DEFAULT '',
      state       TEXT NOT NULL DEFAULT 'inbox',
      name        TEXT NOT NULL,
      ext         TEXT NOT NULL DEFAULT '',
      size        INTEGER NOT NULL DEFAULT 0,
      mtime       INTEGER NOT NULL DEFAULT 0,
      category_id TEXT,
      pinned      INTEGER NOT NULL DEFAULT 0,
      missing     INTEGER NOT NULL DEFAULT 0,
      added_at    INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL DEFAULT 0
    );
  `)
  const fcols = db.prepare('PRAGMA table_info(files)').all() as any[]
  const hasF = (n: string) => fcols.some((c: any) => c.name === n)
  if (!hasF('orig_path')) db.exec("ALTER TABLE files ADD COLUMN orig_path TEXT NOT NULL DEFAULT ''")
  if (!hasF('state')) db.exec("ALTER TABLE files ADD COLUMN state TEXT NOT NULL DEFAULT 'inbox'")
  if (!hasF('moved_at')) db.exec('ALTER TABLE files ADD COLUMN moved_at INTEGER NOT NULL DEFAULT 0')
  db.exec('CREATE INDEX IF NOT EXISTS idx_files_cat ON files(category_id, added_at DESC)')
}

/** 供其它模块（如文件柜）复用同一个连接 */
export function getDb(): DatabaseSync {
  return db
}

/* ---------------- settings ---------------- */

export function getSetting(key: string, fallback: string): string {
  const row: any = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function getPrefs(): Prefs {
  return {
    dailyRemindAt: getSetting('daily_remind_at', '08:30'),
    dailyRemindEnabled: getSetting('daily_remind_enabled', '1') === '1',
    remindMode: getSetting('remind_mode', 'daily') === 'weekly' ? 'weekly' : 'daily',
    remindWeekdays: (() => {
      try {
        const arr = JSON.parse(getSetting('remind_weekdays', '[1,2,3,4,5]'))
        return Array.isArray(arr) && arr.length ? arr.filter((n) => n >= 1 && n <= 7) : [1, 2, 3, 4, 5]
      } catch {
        return [1, 2, 3, 4, 5]
      }
    })(),
    clipboardWatch: getSetting('clipboard_watch', '1') === '1',
    autostart: getSetting('autostart', '0') === '1',
    alwaysOnTop: getSetting('always_on_top', '0') === '1',
    locked: getSetting('locked', '0') === '1',
    panelAlpha: Number(getSetting('panel_alpha', '0.94')),
    bgColor: getSetting('bg_color', 'white') as Prefs['bgColor'],
    bgDim: Number(getSetting('bg_dim', '0.5')),
    bgImage: getSetting('bg_image', ''),
    bgFit: (getSetting('bg_fit', 'contain') === 'cover' ? 'cover' : 'contain') as Prefs['bgFit'],
    pausedUntil: Number(getSetting('paused_until', '0')),
    pauseMinutes: Number(getSetting('pause_minutes', '15')),
    view: (getSetting('view', 'list') === 'grid' ? 'grid' : 'list') as Prefs['view'],
    fontSize: (['small', 'large', 'xl'].includes(getSetting('font_size', 'normal'))
      ? getSetting('font_size', 'normal')
      : 'normal') as Prefs['fontSize'],
    textTone: (() => {
      const v = getSetting('text_tone', 'auto')
      if (v === 'dark') return 'black'
      if (v === 'light') return 'white'
      return (['auto', 'black', 'white', 'blue', 'green', 'yellow'] as const).includes(v as never) ? (v as Prefs['textTone']) : 'auto'
    })(),
    hotkeyCapture: getSetting('hotkey_capture', 'Ctrl+Alt+V'),
    hotkeyPause: getSetting('hotkey_pause', 'Ctrl+Alt+J'),
    hotkeyDesk: getSetting('hotkey_desk', 'Alt+D')
  }
}

export function setPrefs(p: Partial<Prefs>): Prefs {
  if (p.dailyRemindAt !== undefined) setSetting('daily_remind_at', p.dailyRemindAt)
  if (p.remindMode !== undefined) setSetting('remind_mode', p.remindMode)
  if (p.remindWeekdays !== undefined) setSetting('remind_weekdays', JSON.stringify(p.remindWeekdays))
  if (p.dailyRemindEnabled !== undefined) setSetting('daily_remind_enabled', p.dailyRemindEnabled ? '1' : '0')
  if (p.clipboardWatch !== undefined) setSetting('clipboard_watch', p.clipboardWatch ? '1' : '0')
  if (p.autostart !== undefined) setSetting('autostart', p.autostart ? '1' : '0')
  if (p.alwaysOnTop !== undefined) setSetting('always_on_top', p.alwaysOnTop ? '1' : '0')
  if (p.locked !== undefined) setSetting('locked', p.locked ? '1' : '0')
  if (p.panelAlpha !== undefined) setSetting('panel_alpha', String(p.panelAlpha))
  if (p.bgColor !== undefined) setSetting('bg_color', p.bgColor)
  if (p.bgDim !== undefined) setSetting('bg_dim', String(p.bgDim))
  if (p.bgImage !== undefined) setSetting('bg_image', p.bgImage)
  if (p.bgFit !== undefined) setSetting('bg_fit', p.bgFit)
  if (p.pausedUntil !== undefined) setSetting('paused_until', String(Math.floor(p.pausedUntil)))
  if (p.pauseMinutes !== undefined) setSetting('pause_minutes', String(p.pauseMinutes))
  if (p.view !== undefined) setSetting('view', p.view)
  if (p.fontSize !== undefined) setSetting('font_size', p.fontSize)
  if (p.textTone !== undefined) setSetting('text_tone', p.textTone)
  if (p.hotkeyCapture !== undefined) setSetting('hotkey_capture', p.hotkeyCapture)
  if (p.hotkeyPause !== undefined) setSetting('hotkey_pause', p.hotkeyPause)
  if (p.hotkeyDesk !== undefined) setSetting('hotkey_desk', p.hotkeyDesk)
  return getPrefs()
}

/* ---------------- tasks ---------------- */

export interface AddTaskInput {
  id: string
  title: string
  imagePath: string
  thumbPath: string
  imgHash: string
  source: string
  dueAt?: number | null
}

/** 返回 null 表示这张图已经存在（哈希重复），未入库 */
export function addTask(input: AddTaskInput): Task | null {
  const exists: any = db.prepare('SELECT id FROM tasks WHERE img_hash = ?').get(input.imgHash)
  if (exists) return null

  const t = now()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `INSERT INTO tasks(id, title, image_path, thumb_path, img_hash, due_at, status, source, reopen_count, created_at)
       VALUES(?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`
    ).run(
      input.id,
      input.title,
      input.imagePath,
      input.thumbPath,
      input.imgHash,
      input.dueAt ?? null,
      input.source,
      t
    )
    db.prepare('INSERT INTO task_events(task_id, action, at) VALUES(?, ?, ?)').run(input.id, 'create', t)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return getTask(input.id)
}

export function getTask(id: string): Task | null {
  const r: any = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  return r ? rowToTask(r) : null
}

export function hashExists(hash: string): boolean {
  const r: any = db.prepare('SELECT 1 AS x FROM tasks WHERE img_hash = ?').get(hash)
  return !!r
}

export function pendingSummary(): { count: number; oldestDays: number } {
  const r: any = db
    .prepare(
      "SELECT COUNT(*) AS n, MIN(created_at) AS o FROM tasks WHERE status = 'pending' AND deleted_at IS NULL"
    )
    .get()
  const n = r?.n ?? 0
  const o = r?.o
  return { count: n, oldestDays: o ? daysHeldFrom(o) : 0 }
}

export function listTasks(): { pending: Task[]; done: Task[] } {
  const pending = (db
    .prepare(
      "SELECT * FROM tasks WHERE status = 'pending' AND deleted_at IS NULL ORDER BY pinned DESC, sort_order ASC, created_at DESC"
    )
    .all() as any[]).map(rowToTask)

  const done = (db
    .prepare("SELECT * FROM tasks WHERE status = 'done' AND deleted_at IS NULL ORDER BY completed_at DESC LIMIT 1000")
    .all() as any[]).map(rowToTask)

  return { pending, done }
}

/** 启动时清掉上次没来得及物理删除的软删除记录 */
export function purgeDeleted(): string[] {
  const rows = (db.prepare('SELECT id FROM tasks WHERE deleted_at IS NOT NULL').all() as any[]) ?? []
  const files: string[] = []
  for (const r of rows) files.push(...purgeTask(r.id))
  return files
}

export function countPending(): number {
  const r: any = db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'pending' AND deleted_at IS NULL")
    .get()
  return r?.n ?? 0
}

/**
 * 勾选 / 取消勾选。返回是否真的发生了状态变更。
 * UPDATE 带 status 条件 + 事务，防止连点写入重复事件。
 */
export function setDone(id: string, done: boolean): boolean {
  const t = now()
  db.exec('BEGIN IMMEDIATE')
  try {
    let changed = 0
    if (done) {
      const r = db
        .prepare("UPDATE tasks SET status='done', completed_at=? WHERE id=? AND status='pending'")
        .run(t, id)
      changed = Number(r.changes)
      if (changed > 0) {
        db.prepare('INSERT INTO task_events(task_id, action, at) VALUES(?, ?, ?)').run(id, 'complete', t)
      }
    } else {
      const r = db
        .prepare(
          "UPDATE tasks SET status='pending', completed_at=NULL, reopen_count=reopen_count+1 WHERE id=? AND status='done'"
        )
        .run(id)
      changed = Number(r.changes)
      if (changed > 0) {
        db.prepare('INSERT INTO task_events(task_id, action, at) VALUES(?, ?, ?)').run(id, 'reopen', t)
      }
    }
    db.exec('COMMIT')
    return changed > 0
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** 拖动排序：按传入的 id 顺序重写 sort_order */
export function reorderTasks(ids: string[]): void {
  const stmt = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?')
  db.exec('BEGIN')
  try {
    ids.forEach((id, i) => stmt.run(i + 1, id))
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function setPinned(id: string, pinned: boolean): void {
  db.prepare('UPDATE tasks SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
}

export function setColor(id: string, color: string): void {
  const ok = ['none', 'red', 'orange', 'green']
  if (!ok.includes(color)) return
  db.prepare('UPDATE tasks SET color = ? WHERE id = ?').run(color, id)
}

export function setTitle(id: string, title: string): void {
  db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(title, id)
}

export function setDue(id: string, dueAt: number | null): void {
  db.prepare('UPDATE tasks SET due_at = ? WHERE id = ?').run(dueAt, id)
}

/**
 * 软删除：只打标记，5 秒内还能撤销。返回被删的任务，交给 toast 用。
 */
export function softDelete(id: string): Task | null {
  const t = getTask(id)
  if (!t) return null
  const r = db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now(), id)
  return Number(r.changes) > 0 ? t : null
}

export function undelete(id: string): void {
  db.prepare('UPDATE tasks SET deleted_at = NULL WHERE id = ?').run(id)
}

/**
 * 物理删除（撤销窗口过了才调用），返回要清理的图片相对路径。
 */
export function purgeTask(id: string): string[] {
  const row: any = db.prepare('SELECT image_path, thumb_path FROM tasks WHERE id = ?').get(id)
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM task_events WHERE task_id = ?').run(id)
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return row ? [row.image_path, row.thumb_path] : []
}

/**
 * 仅用于「撤销本次收录」：直接物理删除，不走软删除。
 */
export function removeTask(id: string): void {
  const files = purgeTask(id)
  for (const rel of files) {
    try {
      fs.unlinkSync(path.join(dataRoot, rel))
    } catch {
      /* 文件可能已不存在，忽略 */
    }
  }
}
