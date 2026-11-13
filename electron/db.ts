import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Prefs, RepeatKind, RepeatRule, Task } from '../shared/types'

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

/* ---------------- 重复任务 ---------------- */

/** 当天 0 点（epoch 秒） */
function startOfDay(d: Date): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return Math.floor(x.getTime() / 1000)
}

/** ISO 星期：1=周一 … 7=周日 */
function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

function parseNums(s: string): number[] {
  return (s || '')
    .split(',')
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
}

function joinNums(a: number[]): string {
  return Array.from(new Set(a)).sort((x, y) => x - y).join(',')
}

/**
 * 算出「下一次该做」的日期（当天 0 点）。from 默认今天。
 * - 每天：明天
 * - 每周：往后找第一个命中的星期几（可多选）
 * - 每月：往后找第一个命中的几号（可多选）；小月没有 31 号时按当月最后一天算
 */
export function computeNextDue(rule: RepeatRule, from: Date = new Date()): number | null {
  const { kind, weekdays, days } = rule
  if (kind === 'none') return null
  if (kind === 'daily') {
    const d = new Date(from)
    d.setDate(d.getDate() + 1)
    return startOfDay(d)
  }
  if (kind === 'weekly') {
    if (!weekdays.length) return null
    for (let i = 1; i <= 21; i++) {
      const d = new Date(from)
      d.setDate(d.getDate() + i)
      if (weekdays.includes(isoWeekday(d))) return startOfDay(d)
    }
    return null
  }
  // monthly
  if (!days.length) return null
  for (let i = 1; i <= 400; i++) {
    const d = new Date(from)
    d.setDate(d.getDate() + i)
    const last = daysInMonth(d)
    const valid = days.map((x) => Math.min(x, last))
    if (valid.includes(d.getDate())) return startOfDay(d)
  }
  return null
}

/**
 * 校验并归一化前端传进来的规则。
 * 关键：规则不完整（每周没选星期 / 每月没选日期）时**退回一次性**，
 * 否则算不出 next_due，任务完成后会永远停在「已完成」，再也不回到待办。
 */
function normalizeRule(input?: RepeatRule | null): RepeatRule {
  const kinds: RepeatKind[] = ['none', 'daily', 'weekly', 'monthly']
  const rawKind = (input?.kind ?? 'none') as RepeatKind
  const kind = kinds.includes(rawKind) ? rawKind : 'none'
  const weekdays = (input?.weekdays ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  const days = (input?.days ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31)
  if (kind === 'weekly' && weekdays.length === 0) return { kind: 'none', weekdays: [], days: [] }
  if (kind === 'monthly' && days.length === 0) return { kind: 'none', weekdays: [], days: [] }
  return { kind, weekdays, days }
}

function ruleOf(r: any): RepeatRule {
  return {
    kind: (r.repeat_kind ?? 'none') as RepeatKind,
    weekdays: parseNums(r.repeat_weekdays ?? '').filter((n) => n >= 1 && n <= 7),
    days: parseNums(r.repeat_days ?? '').filter((n) => n >= 1 && n <= 31)
  }
}

/**
 * 重复任务跨天回到待办列表。
 * 昨天点过完成的，今天 next_due 到期 → 状态翻回 pending。
 * 逾期的（next_due 早就过了）也一样翻回来，由界面标「逾期」，绝不自动跳过。
 */
export function rolloverRepeats(): number {
  const today = startOfDay(new Date())
  const r = db
    .prepare(
      `UPDATE tasks SET status='pending', completed_at=NULL
       WHERE repeat_kind != 'none' AND status='done' AND deleted_at IS NULL
         AND next_due IS NOT NULL AND next_due <= ?`
    )
    .run(today)
  return Number(r.changes)
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
    daysHeld: daysHeldFrom(r.created_at),
    repeat: ruleOf(r),
    doneCount: r.done_count ?? 0,
    nextDue: r.next_due ?? null
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
  if (!has('repeat_kind')) db.exec("ALTER TABLE tasks ADD COLUMN repeat_kind TEXT NOT NULL DEFAULT 'none'")
  if (!has('repeat_weekdays')) db.exec("ALTER TABLE tasks ADD COLUMN repeat_weekdays TEXT NOT NULL DEFAULT ''")
  if (!has('repeat_days')) db.exec("ALTER TABLE tasks ADD COLUMN repeat_days TEXT NOT NULL DEFAULT ''")
  if (!has('next_due')) db.exec('ALTER TABLE tasks ADD COLUMN next_due INTEGER')
  if (!has('done_count')) db.exec('ALTER TABLE tasks ADD COLUMN done_count INTEGER NOT NULL DEFAULT 0')

  // 每次完成的流水，重复任务靠它统计和留痕
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_done_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      done_at INTEGER NOT NULL
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_done_log ON task_done_log(task_id, done_at DESC)')

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
    hotkeyDesk: getSetting('hotkey_desk', 'Alt+D'),
    hotkeyDesk2: getSetting('hotkey_desk2', 'Alt+S')
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
  if (p.hotkeyDesk2 !== undefined) setSetting('hotkey_desk2', p.hotkeyDesk2)
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

/**
 * 手动新建待办：没有图片。
 * image_path/thumb_path 存空串（表上是 NOT NULL，不能塞 null），
 * img_hash 用唯一串占位 —— 那张表上建了 UNIQUE 索引，空串会互相冲突。
 */
export function addManualTask(title: string, rule?: RepeatRule): Task {
  const id = 'm_' + crypto.randomUUID().slice(0, 8)
  const t = now()
  const r = normalizeRule(rule)
  const next = computeNextDue(r)

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `INSERT INTO tasks(id, title, image_path, thumb_path, img_hash, due_at, status, source,
                         reopen_count, created_at, repeat_kind, repeat_weekdays, repeat_days, next_due, done_count)
       VALUES(?, ?, '', '', ?, NULL, 'pending', 'manual', 0, ?, ?, ?, ?, ?, 0)`
    ).run(
      id,
      title,
      'manual:' + crypto.randomUUID(),
      t,
      r.kind,
      r.kind === 'weekly' ? joinNums(r.weekdays) : '',
      r.kind === 'monthly' ? joinNums(r.days) : '',
      next
    )
    db.prepare('INSERT INTO task_events(task_id, action, at) VALUES(?, ?, ?)').run(id, 'create', t)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return getTask(id) as Task
}

/** 改重复规则；改成一次性时把 next_due 一起清掉 */
export function setRepeat(id: string, input: RepeatRule): void {
  const rule = normalizeRule(input)
  const kind = rule.kind
  const wd = kind === 'weekly' ? joinNums(rule.weekdays) : ''
  const dd = kind === 'monthly' ? joinNums(rule.days) : ''
  const next = computeNextDue(rule)
  db.prepare(
    'UPDATE tasks SET repeat_kind = ?, repeat_weekdays = ?, repeat_days = ?, next_due = ? WHERE id = ?'
  ).run(kind, wd, dd, next, id)
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
  rolloverRepeats()
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
  // 先看这条是不是重复任务，决定要不要记流水、推下次日期
  const row = db
    .prepare('SELECT repeat_kind, repeat_weekdays, repeat_days FROM tasks WHERE id = ?')
    .get(id) as any
  const kind = (row?.repeat_kind ?? 'none') as RepeatKind
  const isRepeat = kind !== 'none'

  db.exec('BEGIN IMMEDIATE')
  try {
    let changed = 0
    if (done) {
      const r = db
        .prepare("UPDATE tasks SET status='done', completed_at=? WHERE id=? AND status='pending'")
        .run(t, id)
      changed = Number(r.changes)
      if (changed > 0) {
        if (isRepeat) {
          // 记录这一次，并把「下次该做」推到下个周期；跨天由 rolloverRepeats 翻回待办
          const next = computeNextDue({
            kind,
            weekdays: parseNums(row.repeat_weekdays),
            days: parseNums(row.repeat_days)
          })
          db.prepare('UPDATE tasks SET done_count = done_count + 1, next_due = ? WHERE id = ?').run(next, id)
          db.prepare('INSERT INTO task_done_log(task_id, done_at) VALUES(?, ?)').run(id, t)
        }
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
        if (isRepeat) {
          // 取消完成：把那一次流水也撤掉，次数回退
          db.prepare(
            'DELETE FROM task_done_log WHERE id = (SELECT id FROM task_done_log WHERE task_id = ? ORDER BY done_at DESC, id DESC LIMIT 1)'
          ).run(id)
          db.prepare('UPDATE tasks SET done_count = MAX(0, done_count - 1) WHERE id = ?').run(id)
        }
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

/** 给已有任务补一张图（手动新建的待办后续加图走这里） */
export function setTaskImage(id: string, imagePath: string, thumbPath: string, hash: string): void {
  db.prepare('UPDATE tasks SET image_path = ?, thumb_path = ?, img_hash = ? WHERE id = ?').run(
    imagePath,
    thumbPath,
    hash,
    id
  )
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
