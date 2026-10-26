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
 * 踩过的坑：
 * 1. **不能加 -WindowStyle Hidden** —— 宿主窗口隐藏后，它弹出的属性框也一起不显示，
 *    表现出来就是"点了没反应"。
 * 2. 必须把路径拆成「目录 + 文件名」再 Namespace(目录).ParseName(文件名)，
 *    直接 ParseName(完整路径) 不可靠。
 * 3. 必须加 -STA：Shell.Application 的 InvokeVerb 在 MTA 线程里会静默失败。
 * 4. 属性框是模态的，用户关掉之前宿主进程不退出，回调会等很久。
 */
export function showFileProperties(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const safe = filePath.replace(/'/g, "''")
    const script = [
      `$p = '${safe}'`,
      '$dir = Split-Path -LiteralPath $p -Parent',
      '$leaf = Split-Path -LiteralPath $p -Leaf',
      '$sh = New-Object -ComObject Shell.Application',
      '$folder = $sh.Namespace($dir)',
      'if ($folder -eq $null) { Write-Output "NOFOLDER"; exit 2 }',
      '$item = $folder.ParseName($leaf)',
      'if ($item -eq $null) { Write-Output "NOITEM"; exit 3 }',
      '$item.InvokeVerb("properties")',
      'Write-Output "OK"'
    ].join('; ')

    let settled = false
    const done = (v: boolean): void => {
      if (settled) return
      settled = true
      resolve(v)
    }
    const timer = setTimeout(() => {
      log('超时 45s 未返回')
      done(false)
    }, 45_000)

    log(`开始: ${filePath}`)
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
      { windowsHide: true },
      (err, stdout, stderr) => {
        clearTimeout(timer)
        log(`结束: err=${err ? err.message : 'none'} out=${String(stdout).trim()} errOut=${String(stderr).trim()}`)
        done(!err)
      }
    )
  })
}
