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
 * 踩过的坑（按踩的顺序）：
 * 1. 不能加 `-WindowStyle Hidden` —— 宿主窗口被隐藏后，它弹出的属性框一起不显示。
 * 2. 必须拆成「目录 + 文件名」再 `Namespace(目录).ParseName(文件名)`，
 *    `ParseName(完整路径)` 不可靠。
 * 3. **不能用 Split-Path 拆路径** —— `-LiteralPath` 配 `-Parent` 在某些输入下会报
 *    `AmbiguousParameterSet`，导致整条命令挂掉、属性框根本不弹。改用 .NET 的
 *    `[System.IO.Path]::GetDirectoryName / GetFileName`，纯字符串处理，不会解析歧义。
 * 4. 必须加 `-STA`：`Shell.Application` 的 `InvokeVerb` 在 MTA 线程里静默失败。
 * 5. 属性框是模态的，用户关掉之前宿主进程不退出，回调会等很久。
 */
export function showFileProperties(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const safe = filePath.replace(/'/g, "''")
    const script = [
      `$p = '${safe}'`,
      '$dir = [System.IO.Path]::GetDirectoryName($p)',
      '$leaf = [System.IO.Path]::GetFileName($p)',
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
