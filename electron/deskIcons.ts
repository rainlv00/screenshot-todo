import { execFile } from 'node:child_process'

/**
 * 系统桌面图标的显示开关。
 *
 * 只动当前用户（HKCU）下的 HideIcons 一个值，不碰机器级配置，
 * 退出分区时一定会恢复成用户原来的状态。
 */
const KEY_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced'

/** 读当前值：1=隐藏，0/不存在=显示 */
export function getIconsHidden(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('reg', ['query', KEY_PATH, '/v', 'HideIcons'], (err, stdout) => {
      if (err) return resolve(false)
      resolve(/HideIcons\s+REG_DWORD\s+0x1/i.test(String(stdout)))
    })
  })
}

/** 设置桌面图标显示/隐藏，并通知桌面刷新 */
export function setIconsHidden(hidden: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['add', KEY_PATH, '/v', 'HideIcons', '/t', 'REG_DWORD', '/d', hidden ? '1' : '0', '/f'],
      (err) => {
        if (err) return resolve(false)
        // 让资源管理器重新读配置，用户不用手动按 F5
        execFile('rundll32', ['user32.dll,UpdatePerUserSystemParameters'], () => resolve(true))
      }
    )
  })
}
