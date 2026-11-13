import type { RepeatKind, RepeatRule, Task } from '../../shared/types'

export const WEEK_LABEL = ['一', '二', '三', '四', '五', '六', '日']

export function emptyRule(kind: RepeatKind = 'none'): RepeatRule {
  return { kind, weekdays: [], days: [] }
}

/** 一周里哪些星期（1=周一 … 7=周日） */
export function toggleWeekday(rule: RepeatRule, d: number): RepeatRule {
  const has = rule.weekdays.includes(d)
  const weekdays = has ? rule.weekdays.filter((x) => x !== d) : [...rule.weekdays, d].sort((a, b) => a - b)
  return { ...rule, weekdays }
}

/** 一个月里哪几号（1-31） */
export function toggleDay(rule: RepeatRule, d: number): RepeatRule {
  const has = rule.days.includes(d)
  const days = has ? rule.days.filter((x) => x !== d) : [...rule.days, d].sort((a, b) => a - b)
  return { ...rule, days }
}

/** 规则是否完整：每周至少要选一天，每月至少要选一号 */
export function ruleReady(rule: RepeatRule): boolean {
  if (rule.kind === 'weekly') return rule.weekdays.length > 0
  if (rule.kind === 'monthly') return rule.days.length > 0
  return true
}

/** 列表里显示的小标签：每天 / 每周一、四 / 每月 5、15 日 */
export function repeatLabel(rule: RepeatRule): string {
  if (rule.kind === 'none') return ''
  if (rule.kind === 'daily') return '每天'
  if (rule.kind === 'weekly') {
    if (!rule.weekdays.length) return '每周'
    return `每周${rule.weekdays.map((d) => WEEK_LABEL[d - 1] ?? '').join('、')}`
  }
  if (!rule.days.length) return '每月'
  return `每月 ${rule.days.join('、')} 日`
}

/**
 * 这条重复任务拖了几天没做。
 * 已过 next_due 的算逾期：界面要显示出来，绝不自动跳过。
 */
export function repeatOverdueDays(task: Task, now = new Date()): number {
  if (task.repeat.kind === 'none' || !task.nextDue) return 0
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const todayTs = Math.floor(today.getTime() / 1000)
  if (task.nextDue >= todayTs) return 0
  return Math.floor((todayTs - task.nextDue) / 86400)
}
