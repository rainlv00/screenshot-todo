import { app, net, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

/** 更新模块自己记日志，避免和主进程互相依赖 */
function logCrash(where: string, err: unknown): void {
  const msg = err instanceof Error ? err.stack || err.message : String(err)
  console.error(`[${where}]`, msg)
}

const REPO = 'rainlv00/screenshot-todo'
const API = `https://api.github.com/repos/${REPO}/releases/latest`
const UA = 'screenshot-todo-updater'

export interface UpdateInfo {
  version: string
  current: string
  notes: string
  url: string
  size: number
  publishedAt: string
}

export type DownloadState = {
  status: 'idle' | 'downloading' | 'ready' | 'error'
  percent: number
  error?: string
}

/** 版本号比较：a 比 b 新返回 true */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

/** 当前版本，测试时可用 WDY_FAKE_VERSION 假装成旧版本 */
function currentVersion(): string {
  return process.env.WDY_FAKE_VERSION || app.getVersion()
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await net.fetch(API, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) {
      logCrash('update-check', new Error(`HTTP ${res.status}`))
      return null
    }
    const rel = (await res.json()) as {
      tag_name?: string
      body?: string
      published_at?: string
      assets?: { name: string; browser_download_url: string; size: number }[]
    }

    const latest = String(rel.tag_name || '').replace(/^v/i, '')
    if (!latest) return null

    const cur = currentVersion()
    if (!isNewer(latest, cur)) return null

    const asset = (rel.assets || []).find((a) => a.name.toLowerCase().endsWith('.exe'))
    if (!asset) return null

    return {
      version: latest,
      current: cur,
      notes: rel.body || '',
      url: asset.browser_download_url,
      size: asset.size,
      publishedAt: rel.published_at || ''
    }
  } catch (err) {
    logCrash('update-check', err)
    return null
  }
}

let downloading = false
let downloadedFile = ''

export function getDownloadState(): DownloadState {
  return state
}

let state: DownloadState = { status: 'idle', percent: 0 }

/**
 * GitHub 在国内直连经常几十 KB/s，100MB 要下几个小时。
 * 先走加速镜像，全部失败再退回直连。
 */
const MIRRORS = ['https://ghfast.top/', 'https://ghproxy.net/', 'https://gh-proxy.com/']

async function fetchWithMirrors(rawUrl: string): Promise<Response> {
  const candidates = [...MIRRORS.map((m) => m + rawUrl), rawUrl]
  let lastErr: unknown = null

  for (const url of candidates) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      const res = await net.fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
      clearTimeout(timer)

      if (!res.ok || !res.body) {
        lastErr = new Error(`HTTP ${res.status}`)
        continue
      }

      // 先读一小段，3 秒内没数据说明这条线是死的
      const reader = res.body.getReader()
      const first = await Promise.race([
        reader.read(),
        new Promise<null>((r) => setTimeout(() => r(null), 3000))
      ])
      if (!first || first.done) {
        lastErr = new Error('首包超时')
        continue
      }

      const rest = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(first.value)
        },
        async pull(controller) {
          const { done, value } = await reader.read()
          if (done) controller.close()
          else controller.enqueue(value)
        },
        cancel() {
          void reader.cancel()
        }
      })

      return new Response(rest, { status: res.status, headers: res.headers })
    } catch (e) {
      lastErr = e
      continue
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('所有下载通道都失败')
}

export async function downloadUpdate(
  info: UpdateInfo,
  onProgress: (s: DownloadState) => void
): Promise<DownloadState> {
  if (downloading) return state
  downloading = true
  state = { status: 'downloading', percent: 0 }
  onProgress(state)

  const dest = path.join(app.getPath('temp'), `截图待办-Setup-${info.version}.exe`)
  try {
    const res = await fetchWithMirrors(info.url)
    if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)

    const total = Number(res.headers.get('content-length') || info.size || 0)
    const reader = res.body.getReader()
    const out = fs.createWriteStream(dest)
    let received = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.write(Buffer.from(value))
      received += value.length
      if (total > 0) {
        const percent = Math.min(99, Math.round((received / total) * 100))
        if (percent !== state.percent) {
          state = { status: 'downloading', percent }
          onProgress(state)
        }
      }
    }
    await new Promise<void>((r) => out.end(r))

    downloadedFile = dest
    state = { status: 'ready', percent: 100 }
    onProgress(state)
    return state
  } catch (err) {
    state = { status: 'error', percent: 0, error: err instanceof Error ? err.message : String(err) }
    onProgress(state)
    logCrash('update-download', err)
    return state
  } finally {
    downloading = false
  }
}

/** 启动安装包（静默），然后退出当前进程 */
export function installUpdate(): boolean {
  if (!downloadedFile || !fs.existsSync(downloadedFile)) return false
  try {
    const child = spawn(downloadedFile, ['/S'], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    setTimeout(() => app.quit(), 300)
    return true
  } catch (err) {
    logCrash('update-install', err)
    return false
  }
}

/** 手动打开 Release 页面（网络不通时兜底） */
export function openReleasePage(): void {
  void shell.openExternal(`https://github.com/${REPO}/releases/latest`)
}
