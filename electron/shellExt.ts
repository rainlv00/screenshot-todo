import { execFile } from 'node:child_process'

/**
 * 弹出 Windows 原生的「文件属性」对话框。
 *
 * Electron 没有这个 API，只能通过 Shell 的 InvokeVerb('properties') 触发。
 * 先按目录定位再按文件名解析，比 Namespace(0).ParseName(完整路径) 可靠。
 *
 * 注意：这个对话框是模态的，用户关掉之前宿主进程不会退出，
 * 所以回调可能等很久——调用方要据此处理（比如先把自己的透明层收起来）。
 */
export function showFileProperties(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    // 单引号字符串里，单引号本身要写成两个
    const safe = filePath.replace(/'/g, "''")
    const script = [
      `$p = '${safe}'`,
      '$dir = Split-Path -LiteralPath $p -Parent',
      '$leaf = Split-Path -LiteralPath $p -Leaf',
      '$sh = New-Object -ComObject Shell.Application',
      '$folder = $sh.Namespace($dir)',
      'if ($folder) { $item = $folder.ParseName($leaf); if ($item) { $item.InvokeVerb("properties") } }'
    ].join('; ')

    let settled = false
    const done = (v: boolean): void => {
      if (settled) return
      settled = true
      resolve(v)
    }
    // 宽松兜底：极端情况下别让调用方永远等下去，把分区层锁在隐藏状态
    const timer = setTimeout(() => done(false), 45_000)

    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      { windowsHide: true },
      (err) => {
        clearTimeout(timer)
        done(!err)
      }
    )
  })
}
