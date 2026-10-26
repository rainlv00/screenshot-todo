import {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  nativeImage,
  Tray,
  Menu,
  protocol,
  net,
  shell,
  screen,
  dialog,
  globalShortcut
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  initDb,
  listTasks,
  addTask,
  setDone,
  setTitle,
  setDue,
  removeTask,
  softDelete,
  undelete,
  purgeTask,
  purgeDeleted,
  countPending,
  pendingSummary,
  hashExists,
  getPrefs,
  setPrefs,
  getSetting,
  setSetting,
  reorderTasks,
  setPinned,
  setColor,
  getDb
} from './db'
import { saveImage, deleteImageFiles, sha1 } from './store'
import { startDailyReminder, type ReminderCtl } from './reminder'
import type { Prefs, ToastPayload } from '../shared/types'
import { checkForUpdate, downloadUpdate, installUpdate, openReleasePage } from './updater'
import {
  ensurePresetCategories,
  listCategories,
  addCategory,
  renameCategory,
  deleteCategory,
  listFiles,
  countFiles,
  addFileByPath,
  removeFile,
  setFilePinned,
  setFileCategory,
  refreshMissing,
  scanDirs,
  getWatchDirs,
  setWatchDirs,
  getAutoScan,
  setAutoScan,
  restoreOne,
  restoreAll,
  storageRoot,
  archiveDesktop,
  addFilesByPaths,
  listArchived,
  archivePendingCount
} from './files'
import { getIconsHidden, setIconsHidden } from './deskIcons'
import { showFileProperties } from './shellExt'

const isDev = !app.isPackaged
const APP_ROOT = app.getAppPath()
/**
 * portable 版会被解压到临时目录运行，app.getPath('exe') 指向临时目录。
 * electron-builder 会注入 PORTABLE_EXECUTABLE_DIR / PORTABLE_EXECUTABLE_FILE 指向真实位置。
 */
const REAL_EXE = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe')
const PROJECT_ROOT = isDev
  ? path.join(__dirname, '..')
  : process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(REAL_EXE)
/**
 * 数据目录固定在用户目录（%APPDATA%\截图待办\data），和 exe 完全分离。
 * 这样以后换版本、重新解压、覆盖安装，都不会碰到已经截的图。
 */
const DATA_DIR = process.env.WDY_DATA_DIR
  ? path.resolve(process.env.WDY_DATA_DIR)
  : path.join(app.getPath('userData'), 'data')
/** 老版本把数据放在 exe 同级的 data 目录，第一次升级时自动搬一次 */
const LEGACY_DATA_DIR = path.join(PROJECT_ROOT, 'data')


/**
 * 老版本数据在 exe 同级 data/ 里。升级后自动搬到用户目录，旧目录留着当备份。
 * 只搬一次：新目录已经有 tasks.db 就不动。
 */
function migrateLegacyData(): void {
  try {
    if (path.normalize(LEGACY_DATA_DIR) === path.normalize(DATA_DIR)) return
    if (!fs.existsSync(path.join(LEGACY_DATA_DIR, 'tasks.db'))) return
    if (fs.existsSync(path.join(DATA_DIR, 'tasks.db'))) return

    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.cpSync(LEGACY_DATA_DIR, DATA_DIR, {
      recursive: true,
      filter: (src) => !src.endsWith('-wal') && !src.endsWith('-shm')
    })
    fs.appendFileSync(
      path.join(DATA_DIR, '..', 'migrate.log'),
      `${new Date().toISOString()} 已从 ${LEGACY_DATA_DIR} 迁移数据\n`
    )
  } catch (err) {
    logCrash('migrate', err)
  }
}

function logCrash(where: string, err: unknown): void {
  try {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    fs.appendFileSync(path.join(PROJECT_ROOT, 'crash.log'), `${new Date().toISOString()} [${where}] ${msg}\n\n`)
  } catch {
    /* 忽略 */
  }
}

process.on('uncaughtException', (e) => logCrash('uncaught', e))
process.on('unhandledRejection', (e) => logCrash('rejection', e))
const ICON_BIG = path.join(APP_ROOT, 'build', 'icon256.png')
const ICON_TRAY = path.join(APP_ROOT, 'build', 'icon20.png')
const DEV_URL = process.env.WDY_DEV_URL || ''
const AUMID = 'com.wdy.screenshottodo'
const CLIP_POLL_MS = 900
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

app.setAppUserModelId(AUMID)

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'todoimg',
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true }
  }
])

let mainWin: BrowserWindow | null = null
let toastWin: BrowserWindow | null = null
let tray: Tray | null = null
let toastTimer: NodeJS.Timeout | null = null
let toastReady = false
let pendingToast: ToastPayload | null = null
let isQuitting = false
let reminder: ReminderCtl | null = null
let watchTimer: NodeJS.Timeout | null = null
let lastClipHash = ''

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

function loadRenderer(win: BrowserWindow, query = ''): void {
  if (DEV_URL) {
    win.loadURL(DEV_URL + (query ? `?${query}` : ''))
    return
  }
  const q: Record<string, string> = {}
  if (query) {
    for (const kv of query.split('&')) {
      const [k, v] = kv.split('=')
      q[k] = v ?? ''
    }
  }
  win.loadFile(path.join(APP_ROOT, 'dist', 'index.html'), { query: q })
}

let fileWin: BrowserWindow | null = null

function createFileWindow(): void {
  if (fileWin && !fileWin.isDestroyed()) {
    fileWin.show()
    fileWin.focus()
    return
  }
  fileWin = new BrowserWindow({
    width: 960,
    height: 660,
    minWidth: 720,
    minHeight: 480,
    title: '文件柜',
    icon: ICON_BIG,
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  loadRenderer(fileWin, 'files=1')
  fileWin.on('closed', () => {
    fileWin = null
    mainWin?.webContents.send('files:closed')
  })

  if (process.env.WDY_SHOT_FILES === '1') {
    fileWin.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await fileWin!.webContents.capturePage()
          fs.writeFileSync(path.join(APP_ROOT, 'shot-cabinet.png'), img.toPNG())
        } catch {
          /* 截图失败忽略 */
        }
        app.quit()
      }, 2400)
    })
  }
}

/** 文件图标缓存：图片按路径缓存缩略图，其它按扩展名缓存系统图标 */
const iconCache = new Map<string, string>()

async function getFileIconUrl(p: string, ext: string, isDir: boolean): Promise<string> {
  const imgExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'heic']
  // 快捷方式按路径缓存（每个目标不同），其他按扩展名共用
  const key = imgExts.includes(ext) || ext === 'lnk' ? `p:${p}` : `e:${isDir ? 'dir' : ext || 'file'}`
  const hit = iconCache.get(key)
  if (hit) return hit

  let url = ''
  try {
    if (imgExts.includes(ext)) {
      // 图片直接出缩略图，比系统图标直观
      const thumb = await nativeImage.createThumbnailFromPath(p, { width: 96, height: 96 })
      if (!thumb.isEmpty()) url = thumb.toDataURL()
    }

    // 快捷方式：Windows 只会给"白纸+箭头"，必须先读出目标再取目标的图标
    if (!url && ext === 'lnk') {
      try {
        const detail = shell.readShortcutLink(p)
        if (detail.target && fs.existsSync(detail.target)) {
          const targetIco = await app.getFileIcon(detail.target, { size: 'large' })
          if (!targetIco.isEmpty()) url = targetIco.toDataURL()
        }
      } catch {
        /* 快捷方式坏了或目标没了，回落到默认图标 */
      }
    }

    if (!url) {
      const ico = await app.getFileIcon(p, { size: 'large' })
      if (!ico.isEmpty()) url = ico.toDataURL()
    }
  } catch {
    /* 读不到就不显示图标 */
  }
  if (url) iconCache.set(key, url)
  return url
}

let previewWin: BrowserWindow | null = null

/** 图片预览独立窗口：大小位置独立记忆，不受主窗口限制 */
function createPreviewWindow(imagePath: string, title: string): void {
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.webContents.send('preview:set', imagePath, title)
    previewWin.show()
    previewWin.focus()
    return
  }

  let bounds: { x?: number; y?: number; width: number; height: number } = { width: 860, height: 660 }
  try {
    const saved = getSetting('preview_bounds', '')
    if (saved) Object.assign(bounds, JSON.parse(saved))
  } catch {
    /* 用默认尺寸 */
  }

  previewWin = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 280,
    title: title || '查看图片',
    icon: ICON_BIG,
    autoHideMenuBar: true,
    backgroundColor: '#101218',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  loadRenderer(previewWin, 'preview=1')
  previewWin.webContents.once('did-finish-load', () => {
    previewWin?.webContents.send('preview:set', imagePath, title)
  })

  const saveBounds = (): void => {
    try {
      if (previewWin && !previewWin.isDestroyed()) {
        setSetting('preview_bounds', JSON.stringify(previewWin.getBounds()))
      }
    } catch {
      /* 忽略 */
    }
  }
  previewWin.on('resize', saveBounds)
  previewWin.on('move', saveBounds)
  previewWin.on('closed', () => {
    previewWin = null
  })
}

let moveWin: BrowserWindow | null = null

/** 分区2：搬运模式。和分区1 互斥，开这个先把分区1 关掉 */
function createMoveWindow(): void {
  if (moveWin && !moveWin.isDestroyed()) {
    moveWin.show()
    moveWin.focus()
    return
  }
  const b = screen.getPrimaryDisplay().bounds
  moveWin = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  loadRenderer(moveWin, 'movedesk=1')
  moveWin.setIgnoreMouseEvents(true, { forward: true })
  moveWin.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') moveWin?.close()
  })

  moveWin.once('ready-to-show', () => {
    moveWin!.setOpacity(0)
    moveWin!.showInactive()
    mainWin?.moveTop()
    setTimeout(() => {
      try {
        moveWin?.setOpacity(1)
      } catch {
        /* 窗口可能已关闭 */
      }
    }, 90)
  })

  moveWin.on('closed', () => {
    moveWin = null
    mainWin?.webContents.send('movedesk:closed')
  })
}

/** 弹系统属性框：先收起分区层，属性框关掉后再恢复 */
async function openFileProperties(filePath: string): Promise<boolean> {
  const wasVisible = !!moveWin && !moveWin.isDestroyed() && moveWin.isVisible()
  try {
    moveWin?.hide()
  } catch {
    /* 忽略 */
  }
  try {
    return await showFileProperties(filePath)
  } finally {
    if (wasVisible && moveWin && !moveWin.isDestroyed()) {
      try {
        moveWin.showInactive()
        moveWin.setOpacity(1)
      } catch {
        /* 窗口可能已经关了 */
      }
    }
  }
}

function createMainWindow(): void {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const height = Math.min(780, Math.max(480, workArea.height - 80))

  mainWin = new BrowserWindow({
    width: 420,
    height,
    minWidth: 320,
    minHeight: 360,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: ICON_BIG,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  loadRenderer(mainWin)

  mainWin.once('ready-to-show', () => {
    applyWindowPrefs()
    mainWin?.show()
  })

  mainWin.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWin?.hide()
    }
  })

  mainWin.on('closed', () => {
    mainWin = null
  })

  if (isDev) {
    mainWin.webContents.once('did-finish-load', () => {
      const mode = process.argv.includes('--selftest')
        ? 'selftest'
        : process.argv.includes('--purge-test')
          ? 'purge'
          : process.argv.includes('--shot')
            ? 'shot'
            : ''
      if (mode) setTimeout(() => void runDevHook(mode), 1500)
    })
  }
}

async function runDevHook(mode: string): Promise<void> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const js = (code: string) => mainWin!.webContents.executeJavaScript(code)

  try {
    if (mode === 'purge') {
      const p = listTasks().pending[0]
      if (!p) {
        console.log('[t] 没有待办可测')
      } else {
        const imgAbs = path.join(DATA_DIR, p.imagePath)
        console.log('[t] 目标 id=%s 文件存在=%s', p.id.slice(0, 8), fs.existsSync(imgAbs))
        scheduleDelete(p.id)
        await wait(500)
        console.log('[t] 软删除后 pending=%d 文件仍在=%s', listTasks().pending.length, fs.existsSync(imgAbs))
        await wait(DELETE_UNDO_MS + 1500)
        console.log('[t] 到期后 pending=%d 文件已删=%s', listTasks().pending.length, !fs.existsSync(imgAbs))
      }
    } else if (mode === 'selftest') {
      const s0 = listTasks()
      console.log('[t] 初始 pending=%d done=%d', s0.pending.length, s0.done.length)

      const firstId = s0.pending[0]?.id
      await js(`document.querySelectorAll('.check')[0]?.click()`)
      await wait(800)
      const s1 = listTasks()
      console.log('[t] 勾选后 pending=%d done=%d', s1.pending.length, s1.done.length)

      await js(`document.querySelectorAll('.tab')[1]?.click()`)
      await wait(600)
      await js(`document.querySelectorAll('.check')[0]?.click()`)
      await wait(800)
      const s2 = listTasks()
      const back = s2.pending.find((t) => t.id === firstId)
      console.log('[t] 拿回后 pending=%d done=%d 该条 reopenCount=%s', s2.pending.length, s2.done.length, back?.reopenCount)

      const target = s2.pending[0]?.id
      console.log('[t] 连点测试 id=%s', target)
      await js(`(async () => {
        const id = ${JSON.stringify(target)};
        await Promise.all([window.api.setDone(id, true), window.api.setDone(id, true), window.api.setDone(id, true)]);
      })()`)
      await wait(900)
      const s3 = listTasks()
      console.log('[t] 连点三次后 pending=%d done=%d', s3.pending.length, s3.done.length)

      // 软删除 + 撤销
      const delId = s3.pending[0]?.id
      if (delId) {
        await js(`(async () => { await window.api.removeTask(${JSON.stringify(delId)}) })()`)
        await wait(700)
        console.log('[t] 删除后 pending=%d', listTasks().pending.length)
        await js(`(async () => { await window.api.undoRemove(${JSON.stringify(delId)}) })()`)
        await wait(700)
        console.log('[t] 撤销删除后 pending=%d', listTasks().pending.length)
      }
    } else {
      if (process.env.WDY_SHOT_SIZE) {
        const [w, h] = process.env.WDY_SHOT_SIZE.split('x').map((x) => parseInt(x, 10))
        if (w && h) {
          mainWin!.setSize(w, h)
          await wait(700)
        }
      }
      if (process.env.WDY_SHOT_GRID === '1') {
        await js(`document.querySelector('.tabs-right .tb-btn')?.click()`)
        await wait(600)
      }
      if (process.env.WDY_SHOT_TAB === 'done') {
        await js(`document.querySelectorAll('.tab')[1]?.click()`)
        await wait(600)
      }
      if (process.env.WDY_SHOT_ALPHA === '1') {
        await js(`document.querySelectorAll('.tb-right .tb-btn')[0]?.click()`)
        await wait(500)
      }
      if (process.env.WDY_SHOT_HELP === '1') {
        await js(`window.__openHelp && window.__openHelp()`)
        await wait(700)
      }
      if (process.env.WDY_SHOT_CAL === '1') {
        await js(`document.querySelector('.festival-bar')?.click()`)
        await wait(700)
      }
      if (process.env.WDY_SHOT_CROP === '1') {
        await js(
          `window.__openCropper && window.__openCropper('.bgpick.jpg', ${Number(process.env.WDY_SHOT_CROP_W) || 1400}, ${Number(process.env.WDY_SHOT_CROP_H) || 900})`
        )
        await wait(800)
      }
      if (process.env.WDY_SHOT_FILES === '1') {
        await js(`document.querySelectorAll('.view-switch button')[1]?.click()`)
        await wait(800)
      }
      if (process.env.WDY_SHOT_HOVER === '1') {
        await js(
          `(() => { const s = document.createElement('style'); s.textContent = '.card .actions{opacity:1 !important}'; document.head.appendChild(s) })()`
        )
        await wait(200)
      }
      if (process.env.WDY_SHOT_SETTINGS === '1') {
        await js(`document.querySelectorAll('.tabs-right .tb-btn')[1]?.click()`)
        await wait(700)
      }
      if (process.env.WDY_SHOT_TOAST === '1') {
        const t = listTasks().pending[0]
        if (t) {
          showToast({
            kind: process.env.WDY_SHOT_TOAST_KIND === 'deleted' ? 'deleted' : 'added',
            taskId: t.id,
            thumbPath: t.thumbPath,
            title: t.title
          })
          await wait(900)
        }
      }
      const img = await mainWin!.webContents.capturePage()
      fs.writeFileSync(path.join(PROJECT_ROOT, 'shot.png'), img.toPNG())
      if (toastWin && toastWin.isVisible()) {
        const ti = await toastWin.webContents.capturePage()
        fs.writeFileSync(path.join(PROJECT_ROOT, 'shot-toast.png'), ti.toPNG())
      }
      console.log('[shot] saved')
    }
  } catch (err) {
    console.error('[hook]', err)
  }

  isQuitting = true
  app.quit()
}

function applyWindowPrefs(): void {
  if (!mainWin) return
  const p = getPrefs()
  mainWin.setAlwaysOnTop(!!p.alwaysOnTop, 'floating')
  mainWin.webContents.send('prefs:changed', p)
  updateTray()
}

function broadcastPrefs(): void {
  const p = getPrefs()
  mainWin?.webContents.send('prefs:changed', p)
}

/* ------------------------------------------------------------------ */
/* 暂停收录                                                            */
/* ------------------------------------------------------------------ */

function isPaused(): boolean {
  return getPrefs().pausedUntil > Date.now() / 1000
}

/** 收录总闸：和界面底部那个滑动开关是同一件事 */
function toggleCapture(): boolean {
  const p = getPrefs()
  const paused = p.pausedUntil * 1000 > Date.now()
  const capturing = p.clipboardWatch && !paused
  setPrefs({ clipboardWatch: !capturing, pausedUntil: 0 })
  broadcastPrefs()
  updateTray()
  return !capturing
}

function setPaused(minutes: number): void {
  const until = minutes > 0 ? Math.floor(Date.now() / 1000) + minutes * 60 : 0
  setPrefs({ pausedUntil: until })
  broadcastPrefs()
  updateTray()
}

/* ------------------------------------------------------------------ */
/* 软删除                                                              */
/* ------------------------------------------------------------------ */

const deleteTimers = new Map<string, NodeJS.Timeout>()
/** 撤销窗口时长。测试时可调小 */
const DELETE_UNDO_MS = Number(process.env.WDY_DELETE_MS || 6000)

function scheduleDelete(id: string): boolean {
  const t = softDelete(id)
  if (!t) return false
  broadcastChanged()
  showToast({ kind: 'deleted', taskId: t.id, thumbPath: t.thumbPath, title: t.title })

  const timer = setTimeout(() => {
    const files = purgeTask(id)
    for (const rel of files) {
      try {
        fs.unlinkSync(path.join(DATA_DIR, rel))
      } catch {
        /* 忽略 */
      }
    }
    deleteTimers.delete(id)
    broadcastChanged()
  }, DELETE_UNDO_MS)
  deleteTimers.set(id, timer)
  return true
}

function undoDelete(id: string): void {
  const timer = deleteTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    deleteTimers.delete(id)
  }
  undelete(id)
  broadcastChanged()
}

function showMain(): void {
  if (!mainWin) createMainWindow()
  if (!mainWin) return
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
}

function toggleMain(): void {
  if (mainWin && mainWin.isVisible() && mainWin.isFocused()) mainWin.hide()
  else showMain()
}

function createToastWindow(): void {
  if (toastWin) return
  const { workArea } = screen.getPrimaryDisplay()
  const w = 300
  const h = 68
  toastWin = new BrowserWindow({
    width: w,
    height: h,
    x: workArea.x + workArea.width - w - 18,
    y: workArea.y + workArea.height - h - 18,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  toastWin.setAlwaysOnTop(true, 'screen-saver')
  toastReady = false
  toastWin.webContents.on('did-finish-load', () => {
    toastReady = true
    if (pendingToast) flushToast()
  })
  loadRenderer(toastWin, 'toast=1')
  toastWin.on('closed', () => {
    toastWin = null
    toastReady = false
  })
}

function flushToast(): void {
  if (!toastWin || !toastReady || !pendingToast) return
  toastWin.webContents.send('toast:show', pendingToast)
  toastWin.showInactive()
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastWin?.hide()
    pendingToast = null
  }, 5200)
}

function showToast(p: ToastPayload): void {
  pendingToast = p
  if (!toastWin) createToastWindow()
  flushToast()
}

function hideToast(): void {
  if (toastTimer) clearTimeout(toastTimer)
  pendingToast = null
  toastWin?.hide()
}

/* ------------------------------------------------------------------ */
/* 收录                                                                */
/* ------------------------------------------------------------------ */

function broadcastChanged(): void {
  mainWin?.webContents.send('tasks:changed')
  updateTray()
}

/**
 * Electron 45 起主进程 clipboard 为 W3C 异步风格：read() 返回 ClipboardItem[]，
 * 每项用 getType(mime) 拿 Blob。这里取出第一张图片。
 */
async function readClipboardImage(): Promise<{ buffer: Buffer; image: Electron.NativeImage } | null> {
  const items = await clipboard.read()
  for (const item of items) {
    const mime = item.types.find((t) => t.startsWith('image/'))
    if (!mime) continue
    const blob = (await item.getType(mime)) as Blob
    const buffer = Buffer.from(await blob.arrayBuffer())
    if (!buffer.length) continue
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) continue
    return { buffer, image }
  }
  return null
}

let capturing = false

async function captureFromClipboard(source: 'clipboard' | 'paste' | 'drag'): Promise<ReturnType<typeof addTask>> {
  if (capturing) return null
  capturing = true
  try {
    const got = await readClipboardImage()
    if (!got) return null

    const hash = sha1(got.buffer)
    if (hash === lastClipHash) return null
    lastClipHash = hash
    if (hashExists(hash)) return null

    const saved = saveImage(DATA_DIR, got.buffer, got.image)
    const task = addTask({
      id: saved.id,
      title: '',
      imagePath: saved.imagePath,
      thumbPath: saved.thumbPath,
      imgHash: saved.hash,
      source
    })
    if (!task) {
      deleteImageFiles(DATA_DIR, [saved.imagePath, saved.thumbPath])
      return null
    }

    broadcastChanged()
    showToast({ kind: 'added', taskId: task.id, thumbPath: task.thumbPath, title: task.title })
    return task
  } catch (err) {
    console.error('[capture]', err)
    return null
  } finally {
    capturing = false
  }
}

function startClipboardWatch(): void {
  if (watchTimer) return
  watchTimer = setInterval(async () => {
    if (!getPrefs().clipboardWatch || capturing) return
    if (isPaused()) return
    try {
      await captureFromClipboard('clipboard')
    } catch (err) {
      console.error('[clipboard]', err)
    }
  }, CLIP_POLL_MS)
}


/** 选图对话框：必须挂父窗口，并且临时取消置顶，否则对话框会被置顶窗口盖住 */
async function pickImageFile(title: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? mainWin
  const wasTop = mainWin?.isAlwaysOnTop() ?? false
  if (wasTop) mainWin?.setAlwaysOnTop(false)
  try {
    const opts: Electron.OpenDialogOptions = {
      title,
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return null
    return r.filePaths?.[0] ?? null
  } finally {
    if (wasTop) mainWin?.setAlwaysOnTop(true, 'floating')
  }
}

/* ------------------------------------------------------------------ */
/* 全局快捷键                                                          */
/* ------------------------------------------------------------------ */

let registeredHotkeys: string[] = []

export function isValidAccel(acc: string): boolean {
  // 至少一个修饰键 + 一个主键，总体 2~3 段
  const parts = acc.split('+').filter(Boolean)
  if (parts.length < 2 || parts.length > 3) return false
  const mods = ['Ctrl', 'Alt', 'Shift', 'Super']
  const hasMod = parts.some((p) => mods.includes(p))
  const main = parts.filter((p) => !mods.includes(p))
  return hasMod && main.length === 1
}

const DEFAULT_CAPTURE = 'Ctrl+Alt+V'
const DEFAULT_PAUSE = 'Ctrl+Alt+J'
const HOTKEY_FALLBACKS = ['Ctrl+Alt+J', 'Ctrl+Alt+K', 'Ctrl+Alt+Q', 'Ctrl+Alt+Z', 'Ctrl+Shift+J', 'Ctrl+Shift+K']

function tryRegister(acc: string, fn: () => void): boolean {
  try {
    return globalShortcut.register(acc, fn)
  } catch {
    return false
  }
}

function registerHotkeys(): void {
  for (const acc of registeredHotkeys) {
    try {
      globalShortcut.unregister(acc)
    } catch {
      /* 忽略 */
    }
  }
  registeredHotkeys = []

  const p = getPrefs()
  const onCapture = () => void captureFromClipboard('paste')
  // 快捷键必须和界面开关行为完全一致：切换"收还是不收"，不是临时暂停
  const onPause = () => void toggleCapture()
  // 分区快捷键：已开就关，没开就开
  const onDesk = () => {
    if (moveWin && !moveWin.isDestroyed()) moveWin.close()
    else createMoveWindow()
  }

  /** 注册一个绑定；仅当它是出厂默认值且被占用时，才自动换成可用的候选 */
  function bind(acc: string, fn: () => void, isDefault: boolean): string {
    if (!acc) return acc
    if (tryRegister(acc, fn)) {
      registeredHotkeys.push(acc)
      return acc
    }
    if (!isDefault) return acc // 用户自己设的，只提示不擅自改
    for (const cand of HOTKEY_FALLBACKS) {
      if (cand === acc) continue
      if (tryRegister(cand, fn)) {
        registeredHotkeys.push(cand)
        logCrash('hotkey', new Error(`默认快捷键 ${acc} 被占用，已自动换成 ${cand}`))
        return cand
      }
    }
    logCrash('hotkey', new Error(`所有候选快捷键都被占用，${acc} 不可用`))
    return acc
  }

  const capture = bind(p.hotkeyCapture, onCapture, p.hotkeyCapture === DEFAULT_CAPTURE)
  const pause = bind(p.hotkeyPause, onPause, p.hotkeyPause === DEFAULT_PAUSE)

  if (capture !== p.hotkeyCapture || pause !== p.hotkeyPause) {
    setPrefs({ hotkeyCapture: capture, hotkeyPause: pause })
    broadcastPrefs()
  }

  updateTray()
}

/* ------------------------------------------------------------------ */
/* 托盘                                                                */
/* ------------------------------------------------------------------ */

function updateTray(): void {
  if (!tray) return
  const { count } = pendingSummary()
  const paused = isPaused()
  const p = getPrefs()
  tray.setToolTip(
    (paused ? '截图待办 · 已暂停收录' : count > 0 ? `截图待办 · ${count} 条待处理` : '截图待办 · 暂无待处理')
  )
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: count > 0 ? `${count} 条待处理` : '暂无待处理', enabled: false },
    { type: 'separator' },
    { label: '打开主窗口', click: () => showMain() },
    { label: `从剪贴板收录一张（${p.hotkeyCapture}）`, click: () => void captureFromClipboard('paste') }
  ]

  if (paused || !p.clipboardWatch) {
    template.push({
      label: '▶ 恢复自动收录',
      click: () => {
        setPrefs({ clipboardWatch: true, pausedUntil: 0 })
        broadcastPrefs()
        updateTray()
      }
    })
  } else {
    const mins = p.pauseMinutes
    template.push({
      label: '广告/教程截图时用：暂停收录',
      submenu: [
        mins > 0
          ? { label: `暂停 ${mins} 分钟`, click: () => setPaused(mins) }
          : { label: '停止收录（直到手动恢复）', click: () => void toggleCapture() },
        { label: '暂停 1 小时', click: () => setPaused(60) },
        { label: '暂停到明天早上', click: () => setPaused(minutesUntilTomorrow()) },
        { type: 'separator' },
        { label: '停止收录（直到手动恢复）', click: () => void toggleCapture() }
      ]
    })
  }

  template.push(
    { type: 'separator' },
    {
      label: p.locked ? '🔓 解锁面板（可拖动）' : '🔒 锁定面板（防误拖）',
      click: () => {
        setPrefs({ locked: !p.locked })
        applyWindowPrefs()
      }
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: p.alwaysOnTop,
      click: (item) => {
        setPrefs({ alwaysOnTop: item.checked })
        applyWindowPrefs()
      }
    },
    { label: '设置…', click: () => { showMain(); mainWin?.webContents.send('ui:openSettings') } },
    { type: 'separator' },
    { label: '打开数据目录', click: () => { shell.openPath(DATA_DIR) } },
    {
      label: '退出截图待办',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  )

  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function minutesUntilTomorrow(): number {
  const now = new Date()
  const tomorrow8 = new Date(now)
  tomorrow8.setDate(now.getDate() + 1)
  tomorrow8.setHours(8, 0, 0, 0)
  return Math.max(1, Math.round((tomorrow8.getTime() - now.getTime()) / 60000))
}

function createTray(): void {
  tray = new Tray(ICON_TRAY)
  tray.on('click', () => toggleMain())
  updateTray()
}

/** 未打包的 exe 想弹系统通知，必须在开始菜单里有带 AUMID 的快捷方式 */
function ensureStartMenuShortcut(): void {
  if (isDev) return
  try {
    const dir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    fs.mkdirSync(dir, { recursive: true })
    const lnk = path.join(dir, '截图待办.lnk')
    if (fs.existsSync(lnk)) {
      // 程序被挪过位置就重建，避免快捷方式指向旧的 exe
      try {
        if (shell.readShortcutLink(lnk).target === REAL_EXE) return
      } catch {
        /* 读取失败就重建 */
      }
    }
    shell.writeShortcutLink(lnk, 'create', {
      target: REAL_EXE,
      cwd: path.dirname(REAL_EXE),
      description: '截图即待办',
      icon: REAL_EXE,
      iconIndex: 0,
      appUserModelId: AUMID
    })
  } catch (err) {
    console.error('[shortcut]', err)
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc(): void {
  ipcMain.handle('tasks:list', () => {
    const { pending, done } = listTasks()
    return { pending, done, pendingCount: countPending() }
  })

  ipcMain.handle('tasks:setDone', (_e, id: string, done: boolean) => {
    const changed = setDone(id, done)
    if (changed) {
      broadcastChanged()
      if (done) hideToast()
    }
    return changed
  })

  ipcMain.handle('tasks:reorder', (_e, ids: string[]) => {
    reorderTasks(ids)
    broadcastChanged()
  })

  ipcMain.handle('tasks:setPinned', (_e, id: string, pinned: boolean) => {
    setPinned(id, pinned)
    broadcastChanged()
  })

  ipcMain.handle('tasks:setColor', (_e, id: string, color: string) => {
    setColor(id, color)
    broadcastChanged()
  })

  ipcMain.handle('tasks:setTitle', (_e, id: string, title: string) => {
    setTitle(id, title)
    broadcastChanged()
  })

  ipcMain.handle('tasks:setDue', (_e, id: string, dueAt: number | null) => {
    setDue(id, dueAt)
    broadcastChanged()
  })

  ipcMain.handle('tasks:undoAdd', (_e, id: string) => {
    removeTask(id)
    hideToast()
    broadcastChanged()
  })

  ipcMain.handle('tasks:remove', (_e, id: string) => {
    return scheduleDelete(id)
  })

  ipcMain.handle('tasks:undoRemove', (_e, id: string) => {
    undoDelete(id)
    hideToast()
  })

  ipcMain.handle('tasks:pasteNow', async () => {
    const t = await captureFromClipboard('paste')
    return !!t
  })

  ipcMain.handle('tasks:importBuffer', (_e, data: Uint8Array) => {
    try {
      const buffer = Buffer.from(data)
      if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return false
      const image = nativeImage.createFromBuffer(buffer)
      if (image.isEmpty()) return false
      const hash = sha1(buffer)
      if (hashExists(hash)) return false
      const saved = saveImage(DATA_DIR, buffer, image)
      const task = addTask({
        id: saved.id,
        title: '',
        imagePath: saved.imagePath,
        thumbPath: saved.thumbPath,
        imgHash: saved.hash,
        source: 'drag'
      })
      if (!task) {
        deleteImageFiles(DATA_DIR, [saved.imagePath, saved.thumbPath])
        return false
      }
      broadcastChanged()
      showToast({ kind: 'added', taskId: task.id, thumbPath: task.thumbPath, title: task.title })
      return true
    } catch (err) {
      console.error('[import]', err)
      return false
    }
  })

  ipcMain.handle('prefs:get', () => getPrefs())

  ipcMain.handle('prefs:set', (_e, p: Partial<Prefs>) => {
    const next = setPrefs(p)
    if (p.autostart !== undefined) {
      try {
        app.setLoginItemSettings({ openAtLogin: next.autostart, path: REAL_EXE })
      } catch (err) {
        console.error('[autostart]', err)
      }
    }
    if (p.dailyRemindAt !== undefined || p.dailyRemindEnabled !== undefined) reminder?.reschedule()
    if (p.hotkeyCapture !== undefined || p.hotkeyPause !== undefined) registerHotkeys()
    if (p.alwaysOnTop !== undefined || p.locked !== undefined) applyWindowPrefs()
    else broadcastPrefs()
    updateTray()
    return next
  })

  /* ---- 文件柜 ---- */
  ipcMain.handle('files:categories', () => listCategories())
  ipcMain.handle('files:list', (_e, categoryId: string | null) => listFiles(categoryId))
  ipcMain.handle('files:count', () => countFiles())
  ipcMain.handle('files:addPaths', (_e, paths: string[]) => {
    let added = 0
    for (const p of paths) {
      if (addFileByPath(p)) added++
    }
    return added
  })
  ipcMain.handle('files:remove', (_e, id: string) => removeFile(id))
  ipcMain.handle('files:pin', (_e, id: string, pinned: boolean) => setFilePinned(id, pinned))
  ipcMain.handle('files:setCategory', (_e, id: string, cat: string) => setFileCategory(id, cat))
  ipcMain.handle('files:addCategory', (_e, name: string, exts: string[]) => addCategory(name, exts))
  ipcMain.handle('files:renameCategory', (_e, id: string, name: string) => renameCategory(id, name))
  ipcMain.handle('files:deleteCategory', (_e, id: string) => deleteCategory(id))
  ipcMain.handle('files:scan', () => scanDirs())
  ipcMain.handle('files:refreshMissing', () => refreshMissing())
  ipcMain.handle('files:restoreOne', (_e, id: string) => restoreOne(id))
  ipcMain.handle('files:storageRoot', () => storageRoot())
  ipcMain.handle('desk:open', (_e, p: string) => shell.openPath(p))

  /* ---- 分区2：搬运模式 ---- */
  ipcMain.handle('movedesk:open', () => createMoveWindow())
  ipcMain.handle('movedesk:close', () => {
    // 关掉分区2 就等于「全部放回」：静默还原，文件不在桌面留着
    const res = restoreAll()
    moveWin?.close()
    return res
  })
  ipcMain.handle('movedesk:files', () => listArchived())
  ipcMain.handle('movedesk:pending', () => archivePendingCount())
  ipcMain.handle('movedesk:archive', () => archiveDesktop())
  /** 把指定路径的文件搬进来（拖拽/单个收录用） */
  ipcMain.handle('movedesk:add', (_e, paths: string[]) => addFilesByPaths(paths))
  ipcMain.handle('movedesk:restore', (_e, id: string) => restoreOne(id))

  /**
   * 分区文件右键菜单：用系统原生菜单，不在渲染层画。
   * 自绘菜单必须依赖窗口形状才点得到，前面已经在这上面栽过两次；
   * 原生菜单是独立窗口，不受透明层形状影响，永远不会"点不动"。
   */
  ipcMain.handle('movedesk:fileMenu', (e, id: string, filePath: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    const menu = Menu.buildFromTemplate([
      { label: '打开', click: () => void shell.openPath(filePath) },
      { label: '在文件夹中显示', click: () => shell.showItemInFolder(filePath) },
      { type: 'separator' },
      { label: '属性', click: () => void openFileProperties(filePath) },
      { type: 'separator' },
      {
        label: '放回桌面',
        click: () => {
          restoreOne(id)
          win.webContents.send('movedesk:refreshed')
        }
      }
    ])
    menu.popup({ window: win })
  })

  /**
   * 把分区里的文件拖出去（原生拖放）。
   * Windows 上拖到桌面默认是「复制」，这里在拖拽发起后盯 10 秒桌面：
   * 一旦出现同名同大小的文件，就把收纳里那份删掉，等效于「移动」。
   */
  ipcMain.on('movedesk:drag', async (e, id: string) => {
    const item = listArchived().find((f) => f.id === id)
    if (!item || !fs.existsSync(item.path)) return
    try {
      const ico = await app.getFileIcon(item.path, { size: 'normal' })
      e.sender.startDrag({ file: item.path, icon: ico.isEmpty() ? nativeImage.createEmpty() : ico })
    } catch {
      return
    }

    // 拖拽是同步阻塞返回的，等它结束后再开始盯
    const desk = app.getPath('desktop')
    const name = path.basename(item.path)
    const srcSize = fs.statSync(item.path).size
    let ticks = 0
    const timer = setInterval(() => {
      ticks++
      const landed = path.join(desk, name)
      try {
        if (fs.existsSync(landed) && fs.statSync(landed).size === srcSize) {
          fs.unlinkSync(item.path)
          getDb()
            .prepare("UPDATE files SET state = 'restored', path = ? WHERE id = ?")
            .run(landed, item.id)
          clearInterval(timer)
          moveWin?.webContents.send('movedesk:refreshed')
        }
      } catch {
        /* 还没写完/被占用，下一轮再试 */
      }
      if (ticks >= 20) clearInterval(timer)
    }, 500)
  })
  ipcMain.handle('movedesk:restoreAll', () => restoreAll())
  ipcMain.handle('movedesk:restoreAllAndClose', () => {
    const res = restoreAll()
    moveWin?.close()
    return { ...res, cancelled: false }
  })
  ipcMain.handle('preview:open', (_e, img: string, title: string) => createPreviewWindow(img, title))
  ipcMain.handle('desk:icon', (_e, p: string, ext: string, isDir: boolean) => getFileIconUrl(p, ext, isDir))
  ipcMain.handle('desk:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('desk:properties', (_e, p: string) => openFileProperties(p))
  /**
   * 把窗口裁成"只有面板存在"的形状。
   * 形状外的区域系统根本不认为有窗口，鼠标直接落桌面，零延迟，
   * 也不再需要靠 mousemove 动态切 ignoreMouseEvents（那套会让拖拽掉 drop）。
   * 传空数组 = 恢复整窗矩形。
   */
  ipcMain.on('desk:shape', (e, rects: { x: number; y: number; width: number; height: number }[]) => {
    const win = e.sender === moveWin?.webContents ? moveWin : null
    if (!win || win.isDestroyed()) return
    try {
      const list = Array.isArray(rects) ? rects.filter((r) => r.width > 0 && r.height > 0) : []
      win.setShape(list)
      // 形状里的部分是正常窗口，形状外系统直接穿透到桌面；
      // 万一某个平台 setShape 没生效，ignoreMouseEvents(true) 保证不挡桌面
      win.setIgnoreMouseEvents(list.length === 0, { forward: true })
    } catch {
      // setShape 不生效时退回到老办法：整窗不挡鼠标
      try {
        win.setIgnoreMouseEvents(true, { forward: true })
      } catch {
        /* 忽略 */
      }
    }
  })
  /** 关掉文件柜：确认后把所有还收着的文件放回原处，再关窗口 */
  ipcMain.handle('files:closeAndRestore', async () => {
    const pending = listFiles(null).length
    if (pending > 0) {
      const r = await dialog.showMessageBox({
        type: 'question',
        buttons: ['全部还原并关闭', '取消'],
        defaultId: 0,
        cancelId: 1,
        title: '关闭文件柜',
        message: `还有 ${pending} 个文件收在柜子里`,
        detail: '关闭后会把它们全部放回原来的位置（桌面），文件不会丢失。'
      })
      if (r.response !== 0) return { restored: 0, failed: 0, cancelled: true }
    }
    const res = restoreAll()
    fileWin?.close()
    return { ...res, cancelled: false }
  })
  ipcMain.handle('files:open', (_e, id: string) => {
    const f = listFiles().find((x) => x.id === id)
    if (f) void shell.openPath(f.path)
  })
  ipcMain.handle('files:reveal', (_e, id: string) => {
    const f = listFiles().find((x) => x.id === id)
    if (f) shell.showItemInFolder(f.path)
  })
  ipcMain.handle('files:getDirs', () => getWatchDirs())
  ipcMain.handle('files:setDirs', (_e, dirs: string[]) => setWatchDirs(dirs))
  ipcMain.handle('files:getAutoScan', () => getAutoScan())
  ipcMain.handle('files:setAutoScan', (_e, on: boolean) => setAutoScan(on))
  ipcMain.handle('app:checkUpdate', () => checkForUpdate())
  ipcMain.handle('app:downloadUpdate', async (_e, info) =>
    downloadUpdate(info, (s) => mainWin?.webContents.send('update:progress', s))
  )
  ipcMain.handle('app:installUpdate', () => installUpdate())
  ipcMain.handle('app:openReleasePage', () => openReleasePage())

  ipcMain.handle('app:hotkeyAvailable', (_e, acc: string) => {
    if (!acc || !isValidAccel(acc)) return { ok: false, reason: 'invalid' as const }
    if (registeredHotkeys.includes(acc)) return { ok: true as const }
    try {
      if (globalShortcut.isRegistered(acc)) return { ok: false, reason: 'taken' as const }
      const ok = globalShortcut.register(acc, () => {})
      if (ok) {
        globalShortcut.unregister(acc)
        return { ok: true as const }
      }
      return { ok: false, reason: 'taken' as const }
    } catch {
      return { ok: false, reason: 'error' as const }
    }
  })

  ipcMain.handle('app:pause', (_e, minutes: number) => {
    setPaused(minutes)
    return getPrefs()
  })

  ipcMain.handle('app:pickBackground', async () => {
    const file = await pickImageFile('选一张图片做面板背景')
    if (!file) return getPrefs()

    const img = nativeImage.createFromPath(file)
    if (img.isEmpty()) return getPrefs()

    const { width, height } = img.getSize()
    const target = 1400
    const resized =
      width > target
        ? img.resize({ width: target, height: Math.max(1, Math.round((height * target) / width)), quality: 'good' })
        : img
    fs.writeFileSync(path.join(DATA_DIR, 'background.jpg'), resized.toJPEG(82))
    const next = setPrefs({ bgImage: 'background.jpg' })
    broadcastPrefs()
    return next
  })

  /** 选图但不落最终文件，交给渲染进程做裁剪 */
  ipcMain.handle('app:pickBackgroundRaw', async () => {
    const file = await pickImageFile('选一张图片，下一步可以裁剪')
    if (!file) return null

    const img = nativeImage.createFromPath(file)
    if (img.isEmpty()) return null

    const { width, height } = img.getSize()
    const max = 2000
    const scaled =
      Math.max(width, height) > max
        ? img.resize({
            width: Math.round((width * max) / Math.max(width, height)),
            height: Math.round((height * max) / Math.max(width, height)),
            quality: 'good'
          })
        : img

    const tmpName = '.bgpick.jpg'
    fs.writeFileSync(path.join(DATA_DIR, tmpName), scaled.toJPEG(90))
    const size = scaled.getSize()
    return { file: tmpName, width: size.width, height: size.height }
  })

  ipcMain.handle('app:cropBackground', (_e, rect: { x: number; y: number; width: number; height: number }) => {
    const tmp = path.join(DATA_DIR, '.bgpick.jpg')
    if (!fs.existsSync(tmp)) return getPrefs()
    const img = nativeImage.createFromPath(tmp)
    if (img.isEmpty()) return getPrefs()

    const bounds = img.getSize()
    const x = Math.max(0, Math.min(Math.round(rect.x), bounds.width - 1))
    const y = Math.max(0, Math.min(Math.round(rect.y), bounds.height - 1))
    const w = Math.max(1, Math.min(Math.round(rect.width), bounds.width - x))
    const h = Math.max(1, Math.min(Math.round(rect.height), bounds.height - y))

    const cropped = img.crop({ x, y, width: w, height: h })
    fs.writeFileSync(path.join(DATA_DIR, 'background.jpg'), cropped.toJPEG(88))
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* 忽略 */
    }
    const next = setPrefs({ bgImage: 'background.jpg' })
    broadcastPrefs()
    return next
  })

  ipcMain.handle('app:cancelBackgroundPick', () => {
    try {
      fs.unlinkSync(path.join(DATA_DIR, '.bgpick.jpg'))
    } catch {
      /* 忽略 */
    }
  })

  ipcMain.handle('app:clearBackground', () => {
    try {
      fs.unlinkSync(path.join(DATA_DIR, 'background.jpg'))
    } catch {
      /* 忽略 */
    }
    const next = setPrefs({ bgImage: '' })
    broadcastPrefs()
    return next
  })

  ipcMain.handle('app:openDataDir', () => {
    shell.openPath(DATA_DIR)
  })

  ipcMain.handle('app:hide', () => mainWin?.hide())

  ipcMain.handle('app:minimize', () => mainWin?.minimize())

  ipcMain.handle('app:quit', () => {
    isQuitting = true
    app.quit()
  })

  ipcMain.on('toast:undo', (_e, id: string, kind: 'added' | 'deleted') => {
    if (kind === 'deleted') {
      undoDelete(id)
    } else {
      removeTask(id)
    }
    hideToast()
    broadcastChanged()
  })

  ipcMain.on('toast:dismiss', () => hideToast())
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMain())

  app.whenReady().then(() => {
    // 图标自测：把桌面快捷方式的图标导出来看看到底取到什么
    if (process.argv.includes('--icon-selftest')) {
      void (async () => {
        const log: string[] = []
        try {
          const dir = app.getPath('desktop')
          const lnks = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.lnk'))
          log.push('桌面 lnk 数量: ' + lnks.length)
          for (const n of lnks.slice(0, 3)) {
            const full = path.join(dir, n)
            const ico = await app.getFileIcon(full, { size: 'large' })
            log.push(`${n} isEmpty=${ico.isEmpty()} size=${ico.getSize().width}x${ico.getSize().height}`)
            if (!ico.isEmpty()) {
              fs.writeFileSync(path.join(APP_ROOT, `lnk-${lnks.indexOf(n)}.png`), ico.toPNG())
            }
          }
        } catch (e) {
          log.push('异常: ' + (e instanceof Error ? e.stack : String(e)))
        }
        fs.writeFileSync(path.join(APP_ROOT, 'icon-selftest.log'), log.join('\n'))
        app.quit()
      })()
      return
    }

    // 归档自测
    if (process.argv.includes('--archive-selftest')) {
      const log: string[] = []
      try {
        initDb(DATA_DIR)
        ensurePresetCategories()
        const r = archiveDesktop()
        log.push('scanned=' + r.scanned)
        log.push('moved=' + JSON.stringify(r.moved))
        log.push('failed=' + JSON.stringify(r.failed))
        log.push('归档后柜内文件数: ' + listArchived().length)
      } catch (e) {
        log.push('异常: ' + (e instanceof Error ? e.stack : String(e)))
      }
      fs.writeFileSync(path.join(APP_ROOT, 'archive-selftest.log'), log.join('\n'))
      app.quit()
      return
    }

    // 文件柜自测：移动 → 记录 → 还原 全链路，结果写日志文件
    if (process.argv.includes('--files-selftest')) {
      const log: string[] = []
      const w = (m: string) => log.push(m)
      try {
        initDb(DATA_DIR)
        ensurePresetCategories()
        const td = path.join(app.getPath('temp'), 'fc-selftest')
        fs.rmSync(td, { recursive: true, force: true })
        fs.mkdirSync(td, { recursive: true })
        const src = path.join(td, '自测文档.txt')
        fs.writeFileSync(src, 'hello world')

        const item = addFileByPath(src)
        w('收录返回: ' + (item ? '成功' : '失败'))
        w('原文件还在原处: ' + fs.existsSync(src))
        if (item) {
          w('记录 orig_path: ' + item.origPath)
          w('记录 path: ' + item.path)
          w('收纳文件存在: ' + fs.existsSync(item.path))
          const ok = restoreOne(item.id)
          w('还原返回: ' + ok)
          w('文件回到原处: ' + fs.existsSync(src))
          const after = listFiles(null).length
          w('还原后柜子里剩余: ' + after)
        }
      } catch (e) {
        w('异常: ' + (e instanceof Error ? e.stack : String(e)))
      }
      fs.writeFileSync(path.join(APP_ROOT, 'fc-selftest.log'), log.join('\n'))
      app.quit()
      return
    }
    migrateLegacyData()
    initDb(DATA_DIR)
    ensurePresetCategories()

    // 上次没删干净的文件，开机清掉
    for (const rel of purgeDeleted()) {
      try {
        fs.unlinkSync(path.join(DATA_DIR, rel))
      } catch {
        /* 忽略 */
      }
    }

    protocol.handle('todoimg', (request) => {
      const u = new URL(request.url)
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '')
      const abs = path.normalize(path.join(DATA_DIR, rel))
      if (!abs.startsWith(path.normalize(DATA_DIR))) {
        return new Response('forbidden', { status: 403 })
      }
      if (!fs.existsSync(abs)) return new Response('not found', { status: 404 })
      return net.fetch(pathToFileURL(abs).toString())
    })

    registerIpc()
    ensureStartMenuShortcut()
    createMainWindow()
  if (process.env.WDY_SHOT_DESK === '1') setTimeout(() => createMoveWindow(), 1200)
  // 截图用：直接扫一遍目录，再把界面切到文件视图
  if (process.env.WDY_SHOT_FILES === '1') {
    try {
      scanDirs()
    } catch {
      /* 测试用，忽略 */
    }
  }
    createTray()
    startClipboardWatch()
    // 截图/测试时可以关掉，避免与正在运行的实例抢快捷键
    if (!process.env.WDY_NO_HOTKEY) registerHotkeys()

    reminder = startDailyReminder({
      onClick: () => showMain(),
      getTray: () => tray
    })

    app.on('activate', () => showMain())
  }).catch((e: unknown) => {
    // 这里抛错以前是静默退出，什么都看不到
    try {
      dialog.showErrorBox('截图待办 启动失败', e instanceof Error ? e.message : String(e))
    } catch {
      /* 弹窗都弹不出来就算了 */
    }
    app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    try {
      globalShortcut.unregisterAll()
    } catch {
      /* 忽略 */
    }
    reminder?.stop()
    if (watchTimer) clearInterval(watchTimer)
  })

  // 托盘常驻：关掉所有窗口也不退出
  app.on('window-all-closed', () => {
    /* 什么也不做 */
  })
}
