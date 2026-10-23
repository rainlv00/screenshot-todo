import { Notification, type Tray } from 'electron'
import { getPrefs, getSetting, setSetting, pendingSummary } from './db'

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface ReminderCtl {
  reschedule: () => void
  stop: () => void
  fireNow: () => void
}

/**
 * 每天固定时间提醒一次「过一遍待办」。
 * 规则：待办为 0 不发；同一天只发一次；错过时间（关机/休眠）后启动会补发一次。
 */
export function startDailyReminder(opts: { onClick: () => void; getTray: () => Tray | null }): ReminderCtl {
  let timer: NodeJS.Timeout | null = null
  let guard: NodeJS.Timeout | null = null

  function targetTs(): number {
    const timeStr = getPrefs().dailyRemindAt || '08:30'
    const [h, m] = timeStr.split(':').map((x) => parseInt(x, 10))
    const d = new Date()
    d.setHours(Number.isFinite(h) ? h : 8, Number.isFinite(m) ? m : 30, 0, 0)
    return d.getTime()
  }

  function fire(): void {
    const prefs = getPrefs()
    if (!prefs.dailyRemindEnabled) return
    if (getSetting('last_remind_date', '') === todayKey()) return
    if (Date.now() < targetTs()) return

    setSetting('last_remind_date', todayKey())

    const { count, oldestDays } = pendingSummary()
    if (count === 0) return

    const body =
      oldestDays > 0 ? `${count} 条待处理，最早一条压了 ${oldestDays} 天` : `${count} 条待处理，都是今天收的`

    try {
      if (Notification.isSupported()) {
        const n = new Notification({ title: '该过一遍待办了', body })
        n.on('click', opts.onClick)
        n.show()
        return
      }
    } catch {
      /* 落到托盘气泡 */
    }
    try {
      opts.getTray()?.displayBalloon({ title: '该过一遍待办了', content: body })
    } catch {
      /* 忽略 */
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer)
    if (!getPrefs().dailyRemindEnabled) return
    let t = targetTs()
    while (t <= Date.now()) t += 86_400_000
    timer = setTimeout(() => {
      fire()
      schedule()
    }, Math.max(1000, t - Date.now()))
  }

  fire()
  schedule()
  guard = setInterval(fire, 60_000)

  return {
    reschedule: schedule,
    fireNow: fire,
    stop: () => {
      if (timer) clearTimeout(timer)
      if (guard) clearInterval(guard)
    }
  }
}
