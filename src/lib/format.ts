export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function dayKey(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayKey(): string {
  return dayKey(Math.floor(Date.now() / 1000))
}

/** 放置天数文案 */
export function heldLabel(days: number): string {
  if (days <= 0) return '今天'
  if (days < 7) return `拖了 ${days} 天`
  if (days < 30) return `拖了 ${Math.floor(days / 7)} 周`
  if (days < 365) return `拖了 ${Math.floor(days / 30)} 个月`
  return `拖了 ${Math.floor(days / 365)} 年`
}

export type HeldLevel = 'calm' | 'warn' | 'hot'

export function heldLevel(days: number): HeldLevel {
  if (days < 3) return 'calm'
  if (days < 7) return 'warn'
  return 'hot'
}

export function clockText(ts: number): string {
  const d = new Date(ts * 1000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dateText(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const same = d.toDateString() === now.toDateString()
  const y = new Date(now.getTime() - 86_400_000)
  if (same) return '今天'
  if (d.toDateString() === y.toDateString()) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function doneText(ts: number): string {
  return `完成于 ${dateText(ts) === '今天' ? '' : dateText(ts) + ' '}${clockText(ts)}`
}

export function dueText(dueAt: number): { text: string; overdue: boolean } {
  const now = Date.now()
  const over = dueAt * 1000 < now
  const d = new Date(dueAt * 1000)
  const base = `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (!over) return { text: `截止 ${base}`, overdue: false }
  const diff = Math.floor((now - dueAt * 1000) / 86_400_000)
  return { text: diff >= 1 ? `已过期 ${diff} 天` : '已过期', overdue: true }
}

/** 把 datetime-local 的值转成 epoch 秒 */
export function localInputToTs(v: string): number | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

export function tsToLocalInput(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
