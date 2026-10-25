import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BgPickResult, ListResult, Prefs, ToastPayload, UpdateInfo } from '../shared/types'

function imgUrl(relPath: string): string {
  if (!relPath) return ''
  const encoded = relPath.split('/').map(encodeURIComponent).join('/')
  return `todoimg://local/${encoded}`
}

const api = {
  list: (): Promise<ListResult> => ipcRenderer.invoke('tasks:list'),
  setDone: (id: string, done: boolean): Promise<boolean> => ipcRenderer.invoke('tasks:setDone', id, done),
  setTitle: (id: string, title: string): Promise<void> => ipcRenderer.invoke('tasks:setTitle', id, title),
  setDue: (id: string, dueAt: number | null): Promise<void> => ipcRenderer.invoke('tasks:setDue', id, dueAt),
  reorder: (ids: string[]): Promise<void> => ipcRenderer.invoke('tasks:reorder', ids),
  setPinned: (id: string, pinned: boolean): Promise<void> =>
    ipcRenderer.invoke('tasks:setPinned', id, pinned),
  setColor: (id: string, color: string): Promise<void> =>
    ipcRenderer.invoke('tasks:setColor', id, color),
  undoAdd: (id: string): Promise<void> => ipcRenderer.invoke('tasks:undoAdd', id),
  removeTask: (id: string): Promise<boolean> => ipcRenderer.invoke('tasks:remove', id),
  undoRemove: (id: string): Promise<void> => ipcRenderer.invoke('tasks:undoRemove', id),
  pause: (minutes: number): Promise<Prefs> => ipcRenderer.invoke('app:pause', minutes),
  hotkeyAvailable: (acc: string): Promise<{ ok: boolean; reason?: 'invalid' | 'taken' | 'error' }> =>
    ipcRenderer.invoke('app:hotkeyAvailable', acc),

  /** 拖进来的 File 对象要转成真实磁盘路径（Electron 32+ 去掉了 file.path） */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  // ---- 文件柜 ----
  files: {
    categories: (): Promise<any[]> => ipcRenderer.invoke('files:categories'),
    list: (categoryId: string | null): Promise<any[]> => ipcRenderer.invoke('files:list', categoryId),
    count: (): Promise<number> => ipcRenderer.invoke('files:count'),
    addPaths: (paths: string[]): Promise<number> => ipcRenderer.invoke('files:addPaths', paths),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('files:remove', id),
    pin: (id: string, pinned: boolean): Promise<void> => ipcRenderer.invoke('files:pin', id, pinned),
    setCategory: (id: string, cat: string): Promise<void> => ipcRenderer.invoke('files:setCategory', id, cat),
    addCategory: (name: string, exts: string[]): Promise<any> => ipcRenderer.invoke('files:addCategory', name, exts),
    renameCategory: (id: string, name: string): Promise<void> =>
      ipcRenderer.invoke('files:renameCategory', id, name),
    deleteCategory: (id: string): Promise<boolean> => ipcRenderer.invoke('files:deleteCategory', id),
    scan: (): Promise<{ added: number; scanned: number }> => ipcRenderer.invoke('files:scan'),
    refreshMissing: (): Promise<number> => ipcRenderer.invoke('files:refreshMissing'),
    open: (id: string): Promise<void> => ipcRenderer.invoke('files:open', id),
    reveal: (id: string): Promise<void> => ipcRenderer.invoke('files:reveal', id),
    getDirs: (): Promise<string[]> => ipcRenderer.invoke('files:getDirs'),
    setDirs: (dirs: string[]): Promise<void> => ipcRenderer.invoke('files:setDirs', dirs),
    getAutoScan: (): Promise<boolean> => ipcRenderer.invoke('files:getAutoScan'),
    setAutoScan: (on: boolean): Promise<void> => ipcRenderer.invoke('files:setAutoScan', on),
    restoreOne: (id: string): Promise<boolean> => ipcRenderer.invoke('files:restoreOne', id),
    storageRoot: (): Promise<string> => ipcRenderer.invoke('files:storageRoot'),
    openWindow: (): Promise<void> => ipcRenderer.invoke('files:openWindow'),
    closeAndRestore: (): Promise<{ restored: number; failed: number; cancelled: boolean }> =>
      ipcRenderer.invoke('files:closeAndRestore'),
    onWindowClosed: (cb: () => void): (() => void) => {
      const h = () => cb()
      ipcRenderer.on('files:closed', h)
      return () => {
        ipcRenderer.removeListener('files:closed', h)
      }
    }
  },

  // ---- 桌面分区 ----
  desk: {
    files: (): Promise<{ files: any[]; added: { name: string; category: string }[] }> =>
      ipcRenderer.invoke('desk:files'),
    collect: (): Promise<{ added: number; total: number }> => ipcRenderer.invoke('desk:collect'),
    icon: (p: string, ext: string, isDir: boolean): Promise<string> =>
      ipcRenderer.invoke('desk:icon', p, ext, isDir),
    open: (p: string): Promise<void> => ipcRenderer.invoke('desk:open', p),
    reveal: (p: string): Promise<void> => ipcRenderer.invoke('desk:reveal', p),
    close: (): Promise<void> => ipcRenderer.invoke('desk:close'),
    setInteractive: (on: boolean): void => ipcRenderer.send('desk:interactive', on),
    onClosed: (cb: () => void): (() => void) => {
      const h = () => cb()
      ipcRenderer.on('desk:closed', h)
      return () => {
        ipcRenderer.removeListener('desk:closed', h)
      }
    }
  },

  // ---- 分区2：搬运模式 ----
  moveDesk: {
    open: (): Promise<void> => ipcRenderer.invoke('movedesk:open'),
    close: (): Promise<void> => ipcRenderer.invoke('movedesk:close'),
    files: (): Promise<any[]> => ipcRenderer.invoke('movedesk:files'),
    pending: (): Promise<number> => ipcRenderer.invoke('movedesk:pending'),
    archive: (): Promise<{ moved: { name: string; category: string }[]; failed: string[]; scanned: number }> =>
      ipcRenderer.invoke('movedesk:archive'),
    restore: (id: string): Promise<boolean> => ipcRenderer.invoke('movedesk:restore', id),
    restoreAllAndClose: (): Promise<{ restored: number; failed: number; cancelled: boolean }> =>
      ipcRenderer.invoke('movedesk:restoreAllAndClose'),
    setInteractive: (on: boolean): void => ipcRenderer.send('desk:interactive', on),
    onClosed: (cb: () => void): (() => void) => {
      const h = () => cb()
      ipcRenderer.on('movedesk:closed', h)
      return () => {
        ipcRenderer.removeListener('movedesk:closed', h)
      }
    }
  },

  // ---- 图片预览 ----
  preview: {
    open: (img: string, title: string): Promise<void> => ipcRenderer.invoke('preview:open', img, title),
    onSet: (cb: (img: string, title: string) => void): (() => void) => {
      const h = (_e: unknown, img: string, title: string) => cb(img, title)
      ipcRenderer.on('preview:set', h as never)
      return () => {
        ipcRenderer.removeListener('preview:set', h as never)
      }
    }
  },

  // ---- 更新 ----
  checkUpdate: (): Promise<UpdateInfo | null> => ipcRenderer.invoke('app:checkUpdate'),
  downloadUpdate: (info: UpdateInfo): Promise<{ status: string; percent: number; error?: string }> =>
    ipcRenderer.invoke('app:downloadUpdate', info),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('app:installUpdate'),
  openReleasePage: (): Promise<void> => ipcRenderer.invoke('app:openReleasePage'),
  onUpdateProgress: (cb: (s: { status: string; percent: number; error?: string }) => void): (() => void) => {
    const h = (_e: unknown, s: { status: string; percent: number; error?: string }) => cb(s)
    ipcRenderer.on('update:progress', h)
    return () => {
      ipcRenderer.removeListener('update:progress', h)
    }
  },
  pickBackground: (): Promise<Prefs> => ipcRenderer.invoke('app:pickBackground'),
  pickBackgroundRaw: (): Promise<BgPickResult | null> => ipcRenderer.invoke('app:pickBackgroundRaw'),
  cropBackground: (rect: { x: number; y: number; width: number; height: number }): Promise<Prefs> =>
    ipcRenderer.invoke('app:cropBackground', rect),
  cancelBackgroundPick: (): Promise<void> => ipcRenderer.invoke('app:cancelBackgroundPick'),
  clearBackground: (): Promise<Prefs> => ipcRenderer.invoke('app:clearBackground'),
  pasteNow: (): Promise<boolean> => ipcRenderer.invoke('tasks:pasteNow'),
  importBuffer: (data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('tasks:importBuffer', data),
  getPrefs: (): Promise<Prefs> => ipcRenderer.invoke('prefs:get'),
  setPrefs: (p: Partial<Prefs>): Promise<Prefs> => ipcRenderer.invoke('prefs:set', p),
  openDataDir: (): Promise<void> => ipcRenderer.invoke('app:openDataDir'),
  hideWindow: (): Promise<void> => ipcRenderer.invoke('app:hide'),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('app:minimize'),
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),

  imgUrl,

  onChanged: (cb: () => void): (() => void) => {
    const h = () => cb()
    ipcRenderer.on('tasks:changed', h)
    return () => ipcRenderer.removeListener('tasks:changed', h)
  },

  onOpenSettings: (cb: () => void): (() => void) => {
    const h = () => cb()
    ipcRenderer.on('ui:openSettings', h)
    return () => ipcRenderer.removeListener('ui:openSettings', h)
  },

  onPrefsChanged: (cb: (p: Prefs) => void): (() => void) => {
    const h = (_e: unknown, p: Prefs) => cb(p)
    ipcRenderer.on('prefs:changed', h as any)
    return () => ipcRenderer.removeListener('prefs:changed', h as any)
  },

  onToast: (cb: (p: ToastPayload) => void): (() => void) => {
    const h = (_e: unknown, p: ToastPayload) => cb(p)
    ipcRenderer.on('toast:show', h as any)
    return () => ipcRenderer.removeListener('toast:show', h as any)
  },

  toastUndo: (id: string, kind: 'added' | 'deleted'): void => ipcRenderer.send('toast:undo', id, kind),
  toastDismiss: (): void => ipcRenderer.send('toast:dismiss')
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
