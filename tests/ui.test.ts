/**
 * 前端纯函数测试：重复标签、规则完整性、多选切换、逾期天数。
 */
import type { RepeatRule, Task } from '../shared/types'
import {
  emptyRule,
  repeatLabel,
  repeatOverdueDays,
  ruleReady,
  toggleDay,
  toggleWeekday
} from '../src/lib/repeat'

let pass = 0
const fails: string[] = []

function eq<T>(a: T, b: T, name: string): void {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++
  else fails.push(`${name} — 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}

const daily = (): RepeatRule => ({ kind: 'daily', weekdays: [], days: [] })
const weekly = (d: number[]): RepeatRule => ({ kind: 'weekly', weekdays: d, days: [] })
const monthly = (d: number[]): RepeatRule => ({ kind: 'monthly', weekdays: [], days: d })

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't',
    title: 't',
    imagePath: '',
    thumbPath: '',
    dueAt: null,
    status: 'pending',
    source: 'manual',
    reopenCount: 0,
    createdAt: 0,
    completedAt: null,
    pinned: false,
    color: 'none',
    sortOrder: 0,
    daysHeld: 0,
    repeat: { kind: 'none', weekdays: [], days: [] },
    doneCount: 0,
    nextDue: null,
    ...over
  }
}

const day = (y: number, m: number, d: number, h = 10): Date => new Date(y, m - 1, d, h, 0, 0)
const ts = (y: number, m: number, d: number): number => Math.floor(day(y, m, d, 0).getTime() / 1000)

// ---------- 标签 ----------
eq(repeatLabel(emptyRule()), '', '一次性：没有标签')
eq(repeatLabel(daily()), '每天', '每天标签')
eq(repeatLabel(weekly([1])), '每周一', '单选周一')
eq(repeatLabel(weekly([1, 4])), '每周一、四', '多选周一、周四')
eq(repeatLabel(weekly([1, 2, 3, 4, 5])), '每周一、二、三、四、五', '多选五个')
eq(repeatLabel(weekly([7])), '每周日', '周日标签')
eq(repeatLabel(monthly([5])), '每月 5 日', '单号')
eq(repeatLabel(monthly([5, 31])), '每月 5、31 日', '多号')
eq(repeatLabel(weekly([])), '每周', '没选星期时的兜底文案')

// ---------- 规则完整性 ----------
eq(ruleReady(emptyRule()), true, '一次性：直接可用')
eq(ruleReady(daily()), true, '每天：可用')
eq(ruleReady(weekly([])), false, '每周没选：不可用')
eq(ruleReady(weekly([3])), true, '每周选一天：可用')
eq(ruleReady(monthly([])), false, '每月没选：不可用')
eq(ruleReady(monthly([1])), true, '每月选一天：可用')

// ---------- 多选切换 ----------
eq(toggleWeekday(weekly([]), 2).weekdays, [2], '勾选周二')
eq(toggleWeekday(weekly([2]), 4).weekdays, [2, 4], '再勾周四（保持升序）')
eq(toggleWeekday(weekly([2, 4]), 2).weekdays, [4], '取消周二')
eq(toggleWeekday(weekly([5]), 5).weekdays, [], '取消唯一选项后为空')

eq(toggleDay(monthly([]), 1).days, [1], '勾选 1 号')
eq(toggleDay(monthly([1]), 15).days, [1, 15], '再勾 15 号')
eq(toggleDay(monthly([1, 15]), 1).days, [15], '取消 1 号')

// ---------- 逾期天数 ----------
const now = day(2026, 11, 10) // 2026-11-10
eq(repeatOverdueDays(task({ repeat: daily(), nextDue: ts(2026, 11, 10) }), now), 0, '计划就是今天：不算逾期')
eq(repeatOverdueDays(task({ repeat: daily(), nextDue: ts(2026, 11, 11) }), now), 0, '计划在明天：不算逾期')
eq(repeatOverdueDays(task({ repeat: daily(), nextDue: ts(2026, 11, 9) }), now), 1, '昨天计划：逾期 1 天')
eq(repeatOverdueDays(task({ repeat: daily(), nextDue: ts(2026, 11, 3) }), now), 7, '上周计划：逾期 7 天')
eq(repeatOverdueDays(task({ repeat: emptyRule(), nextDue: null }), now), 0, '一次性任务：不报逾期')
eq(repeatOverdueDays(task({ repeat: daily(), nextDue: null }), now), 0, '没有下次日期：不报逾期')

const total = pass + fails.length
console.log(`\n用例 ${total} 条：通过 ${pass}，失败 ${fails.length}`)
if (fails.length) {
  console.log('\n失败明细:')
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
}
process.exit(fails.length ? 1 : 0)
