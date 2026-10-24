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

  /** 下一个触发时刻：每天模式就是今天/明天；每周模式要跳过没选中的星期 */
  function targetTs(): number {
    const prefs = getPrefs()
    const timeStr = prefs.dailyRemindAt || '08:30'
    const [h, m] = timeStr.split(':').map((x) => parseInt(x, 10))
    const hh = Number.isFinite(h) ? h : 8
    const mm = Number.isFinite(m) ? m : 30

    const now = Date.now()
    // 最多往后找 8 天，一定命中
    for (let i = 0; i < 8; i++) {
      const d = new Date()
      d.setDate(d.getDate() + i)
      d.setHours(hh, mm, 0, 0)
      if (d.getTime() <= now) continue
      if (prefs.remindMode === 'weekly') {
        const wd = d.getDay() === 0 ? 7 : d.getDay()
        if (!prefs.remindWeekdays.includes(wd)) continue
      }
      return d.getTime()
    }
    return now + 86_400_000
  }

  function fire(): void {
    const prefs = getPrefs()
    if (!prefs.dailyRemindEnabled) return
    if (getSetting('last_remind_date', '') === todayKey()) return
    // 每周模式：今天不是选中的星期就跳过
    if (prefs.remindMode === 'weekly') {
      const now = new Date()
      const wd = now.getDay() === 0 ? 7 : now.getDay()
      if (!prefs.remindWeekdays.includes(wd)) return
    }
    // 还没到当天的提醒时间就不发
    const [h, m] = (prefs.dailyRemindAt || '08:30').split(':').map((x) => parseInt(x, 10))
    const todayTarget = new Date()
    todayTarget.setHours(Number.isFinite(h) ? h : 8, Number.isFinite(m) ? m : 30, 0, 0)
    if (Date.now() < todayTarget.getTime()) return

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
