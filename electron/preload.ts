import { contextBridge, ipcRenderer } from 'electron'
import type { BgPickResult, ListResult, Prefs, ToastPayload } from '../shared/types'

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
  undoAdd: (id: string): Promise<void> => ipcRenderer.invoke('tasks:undoAdd', id),
  removeTask: (id: string): Promise<boolean> => ipcRenderer.invoke('tasks:remove', id),
  undoRemove: (id: string): Promise<void> => ipcRenderer.invoke('tasks:undoRemove', id),
  pause: (minutes: number): Promise<Prefs> => ipcRenderer.invoke('app:pause', minutes),
  hotkeyAvailable: (acc: string): Promise<{ ok: boolean; reason?: 'invalid' | 'taken' | 'error' }> =>
    ipcRenderer.invoke('app:hotkeyAvailable', acc),
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
