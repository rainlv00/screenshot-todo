import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function log(msg: string): void {
  try {
    const p = path.join(process.env.APPDATA || process.cwd(), '截图待办', 'props-debug.log')
    fs.appendFileSync(p, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* 日志写不了就算了 */
  }
}

/**
 * 弹出 Windows 原生的「文件属性」对话框。
 *
 * 走的是 shell 的 Properties 动词（`Start-Process -Verb Properties`），
 * 比 `Shell.Application.InvokeVerb` 那套稳：
 * - InvokeVerb 在隐藏宿主里弹出来的框不会拿到前台焦点，表现为"点了没反应"
 * - InvokeVerb 在 MTA 线程里还会静默失败，必须额外加 -STA
 * - 拆路径不能用 Split-Path（会撞 AmbiguousParameterSet），改用 .NET 的 Path 方法
 *
 * `-Wait` 让进程一直活到用户关掉属性框，调用方据此判断"什么时候恢复自己的透明层"。
 */
export function showFileProperties(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const safe = filePath.replace(/'/g, "''")
    // 路径存在性先在 PowerShell 侧确认，避免拿不存在的路径去调动词
    const script = [
      `$p = '${safe}'`,
      'if (-not (Test-Path -LiteralPath $p)) { Write-Output "MISSING"; exit 4 }',
      'Start-Process -FilePath $p -Verb Properties -Wait',
      'Write-Output "OK"'
    ].join('; ')

    let settled = false
    const done = (v: boolean): void => {
      if (settled) return
      settled = true
      resolve(v)
    }
    const timer = setTimeout(() => {
      log('超时 120s 未返回')
      done(false)
    }, 120_000)

    log(`开始: ${filePath}`)
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
      { windowsHide: true },
      (err, stdout, stderr) => {
        clearTimeout(timer)
        log(`结束: err=${err ? err.message : 'none'} out=${String(stdout).trim()} errOut=${String(stderr).trim()}`)
        done(!err && String(stdout).includes('OK'))
      }
    )
  })
}
