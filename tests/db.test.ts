/**
 * 数据层测试：重复规则 + 手动待办 + 完成/回滚/撤销。
 * 直接跑 Node（db.ts 不依赖 Electron）：esbuild 打包后 node 执行。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  initDb,
  addManualTask,
  setTaskImage,
  setDone,
  setRepeat,
  listTasks,
  computeNextDue,
  getDb,
  addTask
} from '../electron/db'
import type { RepeatRule } from '../shared/types'

let pass = 0
const fails: string[] = []

function ok(cond: boolean, name: string, extra = ''): void {
  if (cond) {
    pass++
  } else {
    fails.push(`${name}${extra ? ` — ${extra}` : ''}`)
  }
}

function eq<T>(actual: T, expect: T, name: string): void {
  ok(
    JSON.stringify(actual) === JSON.stringify(expect),
    name,
    `期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}`
  )
}

/** 本地日期 → "YYYY-MM-DD" */
function ymd(ts: number | null): string {
  if (ts == null) return 'null'
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function at(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 10, 30, 0)
}

const rule = (kind: RepeatRule['kind'], weekdays: number[] = [], days: number[] = []): RepeatRule => ({
  kind,
  weekdays,
  days
})

/** 语义化构造：避免再被 weekdays / days 的顺序坑到 */
const daily = (): RepeatRule => rule('daily')
const weekly = (weekdays: number[]): RepeatRule => rule('weekly', weekdays, [])
const monthly = (days: number[]): RepeatRule => rule('monthly', [], days)

// ---------- 环境 ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yj-test-'))
initDb(dir)
const db = getDb()

// ---------- 1. computeNextDue ----------
eq(ymd(computeNextDue(daily(), at(2026, 10, 31))), '2026-11-01', '每天：跨月到 11-01')
eq(ymd(computeNextDue(daily(), at(2026, 12, 31))), '2027-01-01', '每天：跨年到 2027-01-01')

eq(ymd(computeNextDue(weekly([1, 4]), at(2026, 10, 31))), '2026-11-02', '每周一/四：周六之后是周一')
eq(ymd(computeNextDue(weekly([1, 4]), at(2026, 11, 2))), '2026-11-05', '每周一/四：周一之后是周四')
eq(ymd(computeNextDue(weekly([7]), at(2026, 10, 31))), '2026-11-01', '每周日：周六之后是周日')
eq(computeNextDue(weekly([]), at(2026, 10, 31)), null, '每周但没选星期 → null')
eq(ymd(computeNextDue(weekly([1, 2, 3, 4, 5, 6, 7]), at(2026, 10, 31))), '2026-11-01', '七天全选 = 每天')

eq(ymd(computeNextDue(monthly([5, 31]), at(2026, 10, 31))), '2026-11-05', '每月5/31：10-31 之后是 11-05')
eq(ymd(computeNextDue(monthly([15]), at(2026, 1, 10))), '2026-01-15', '每月15：当月内还有 15 号')
eq(ymd(computeNextDue(monthly([31]), at(2026, 1, 31))), '2026-02-28', '每月31：2 月按月末 28 号')
eq(ymd(computeNextDue(monthly([31]), at(2026, 3, 31))), '2026-04-30', '每月31：4 月按月末 30 号')
eq(computeNextDue(monthly([]), at(2026, 10, 31)), null, '每月但没选日期 → null')
eq(computeNextDue(rule('none'), at(2026, 10, 31)), null, '一次性任务没有下次')

// ---------- 2. 手动新建 ----------
const t1 = addManualTask('交水电费', daily())
eq(t1.imagePath, '', '手动任务：没有图片路径')
eq(t1.thumbPath, '', '手动任务：没有缩略图路径')
eq(t1.source, 'manual', '手动任务：来源标记为 manual')
eq(t1.repeat.kind, 'daily', '手动任务：重复规则写入正确')
eq(t1.doneCount, 0, '手动任务：初始完成次数 0')
ok(t1.nextDue != null, '手动任务：每天都算出了下次日期')

const t2 = addManualTask('周会汇报', weekly([1, 4]))
const t3 = addManualTask('信用卡还款', monthly([5, 31]))
const manualHashes = db
  .prepare("SELECT img_hash FROM tasks WHERE id IN (?, ?, ?)")
  .all(t1.id, t2.id, t3.id) as { img_hash: string }[]
eq(new Set(manualHashes.map((x) => x.img_hash)).size, 3, '三条手动任务 img_hash 互不冲突（不撞唯一索引）')

const t4 = addManualTask('一次性任务')
eq(t4.repeat.kind, 'none', '默认一次性')
eq(t4.nextDue, null, '一次性任务没有下次日期')

// 走真实入口确认能算出日期。
// 注意：这里不能写死具体日期 —— 什么时候跑测试，"下次"就是哪一天。
// 具体日期由上面 computeNextDue 的固定 from 用例保证。
const nowTs = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
ok(t3.nextDue != null && t3.nextDue > nowTs, '每月5/31：新建时算出的是未来日期')
ok(t2.nextDue != null && t2.nextDue > nowTs, '每周一/四：新建时算出的是未来日期')
const t3day = new Date((t3.nextDue ?? 0) * 1000).getDate()
ok(t3day === 5 || t3day === 30 || t3day === 31, `每月5/31：落在 5 号或月末（实际 ${t3day} 号）`)

// ---------- 3. 完成 → 计数 + 流水 + 推进 ----------
const beforeList = listTasks()
ok(beforeList.pending.some((x) => x.id === t1.id), '完成任务前在待办列表里')

eq(setDone(t1.id, true), true, '勾选完成返回 true')
const a1 = db.prepare('SELECT status, done_count, next_due FROM tasks WHERE id=?').get(t1.id) as any
eq(a1.status, 'done', '完成后状态是 done')
eq(a1.done_count, 1, '完成后次数 1')
const logRows = db.prepare('SELECT COUNT(*) AS n FROM task_done_log WHERE task_id=?').get(t1.id) as any
eq(logRows.n, 1, '完成后写入 1 条完成流水')

// 连点：已完成的任务再点完成不应重复计数
eq(setDone(t1.id, true), false, '重复勾选返回 false')
const a2 = db.prepare('SELECT done_count FROM tasks WHERE id=?').get(t1.id) as any
eq(a2.done_count, 1, '重复勾选不会重复计数')

// ---------- 4. 跨天回滚 ----------
const today = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
db.prepare('UPDATE tasks SET next_due=? WHERE id=?').run(today, t1.id)
const l1 = listTasks()
const back = l1.pending.find((x) => x.id === t1.id)
ok(!!back, 'next_due 到期后自动回到待办')
eq(back?.doneCount, 1, '回滚后完成次数保留')
eq(back?.completedAt, null, '回滚后清空 completed_at')

// 逾期：next_due 是 3 天前，也应该回到待办（绝不自动跳过）
db.prepare("UPDATE tasks SET status='done', completed_at=?, next_due=? WHERE id=?").run(
  today,
  today - 3 * 86400,
  t1.id
)
const l2 = listTasks()
ok(l2.pending.some((x) => x.id === t1.id), '逾期任务仍回到待办，不自动跳过')

// ---------- 5. 撤销完成 ----------
setDone(t1.id, true)
const c1 = db.prepare('SELECT done_count FROM tasks WHERE id=?').get(t1.id) as any
setDone(t1.id, false)
const c2 = db.prepare('SELECT done_count FROM tasks WHERE id=?').get(t1.id) as any
const c3 = db.prepare('SELECT COUNT(*) AS n FROM task_done_log WHERE task_id=?').get(t1.id) as any
eq(c1.done_count, c2.done_count + 1, '取消完成后次数 -1')
eq(c3.n, c2.done_count, '取消完成后流水条数与次数一致')

// ---------- 6. 一次性任务不回滚 ----------
setDone(t4.id, true)
const l3 = listTasks()
ok(!l3.pending.some((x) => x.id === t4.id), '一次性任务完成后不会回到待办')
const t4row = db.prepare('SELECT done_count FROM tasks WHERE id=?').get(t4.id) as any
eq(t4row.done_count, 0, '一次性任务不累加重复次数（保持 0）')

// ---------- 7. 改规则 ----------
setRepeat(t2.id, rule('none'))
const r2 = db.prepare('SELECT repeat_kind, next_due FROM tasks WHERE id=?').get(t2.id) as any
eq(r2.repeat_kind, 'none', '改成一次性：规则清空')
eq(r2.next_due, null, '改成一次性：下次日期清空')

setRepeat(t2.id, weekly([1, 4]))
const r3 = db.prepare('SELECT repeat_kind, repeat_weekdays, next_due FROM tasks WHERE id=?').get(t2.id) as any
eq(r3.repeat_kind, 'weekly', '改回每周：规则生效')
eq(r3.repeat_weekdays, '1,4', '改回每周：星期保存为 1,4')
ok(r3.next_due != null, '改回每周：重算了下次日期')

setRepeat(t3.id, monthly([1, 15]))
const r4 = db.prepare('SELECT repeat_days FROM tasks WHERE id=?').get(t3.id) as any
eq(r4.repeat_days, '1,15', '每月多选保存正确')

// ---------- 8. 与截图任务共存 ----------
const shot = addTask({
  id: 'shot1',
  title: '截图任务',
  imagePath: 'images/a.jpg',
  thumbPath: 'thumbs/a.jpg',
  imgHash: 'hash-shot-1',
  source: 'clipboard'
})
ok(!!shot, '截图任务正常入库')
const l4 = listTasks()
ok(l4.pending.some((x) => x.id === 'shot1'), '待办列表里同时有截图任务')
ok(l4.pending.some((x) => x.id === t1.id), '待办列表里同时有手动任务')
eq(shot?.imagePath, 'images/a.jpg', '截图任务图片路径正常')

// ---------- 9. 多次完成的累计 ----------
const t5 = addManualTask('每天三次', daily())
for (let i = 0; i < 3; i++) {
  setDone(t5.id, true)
  // 手动把它推回待办，模拟连续三天
  db.prepare("UPDATE tasks SET status='pending', completed_at=NULL WHERE id=?").run(t5.id)
}
const t5row = db.prepare('SELECT done_count FROM tasks WHERE id=?').get(t5.id) as any
const t5log = db.prepare('SELECT COUNT(*) AS n FROM task_done_log WHERE task_id=?').get(t5.id) as any
eq(t5row.done_count, 3, '累计完成三次 → 次数 3')
eq(t5log.n, 3, '累计完成三次 → 流水 3 条')

// ---------- 10. 非法/不完整规则要退回一次性 ----------
const bad1 = addManualTask('每周但没选天', weekly([]))
eq(bad1.repeat.kind, 'none', '每周没选天：退回一次性')
eq(bad1.nextDue, null, '每周没选天：不产生下次日期')

const bad2 = addManualTask('每月但没选日', monthly([]))
eq(bad2.repeat.kind, 'none', '每月没选日：退回一次性')

const weird = addManualTask('怪规则', { kind: 'yearly' as any, weekdays: [], days: [] })
eq(weird.repeat.kind, 'none', '未知重复类型：退回一次性')

const dirty = addManualTask('越界数据', { kind: 'weekly', weekdays: [0, 3, 9], days: [] })
eq(dirty.repeat.weekdays, [3], '越界星期被过滤（只留 1-7）')

setRepeat(dirty.id, monthly([]))
const dirty2 = db.prepare('SELECT repeat_kind, next_due FROM tasks WHERE id=?').get(dirty.id) as any
eq(dirty2.repeat_kind, 'none', '改成不完整的每月：退回一次性')

// 不完整的规则不该出现「完成后再也回不来」
const bad3 = addManualTask('不完整但被完成', weekly([]))
setDone(bad3.id, true)
const bad3row = db.prepare('SELECT status FROM tasks WHERE id=?').get(bad3.id) as any
eq(bad3row.status, 'done', '退回一次性的任务完成后就是完成')

// ---------- 11. 事后补图 ----------
const m1 = addManualTask('后来加图')
setTaskImage(m1.id, 'images/m1.jpg', 'thumbs/m1.jpg', 'hash-m1')
const m1row = db.prepare('SELECT image_path, thumb_path, img_hash FROM tasks WHERE id=?').get(m1.id) as any
eq(m1row.image_path, 'images/m1.jpg', '补图：主图路径写入')
eq(m1row.thumb_path, 'thumbs/m1.jpg', '补图：缩略图路径写入')
eq(m1row.img_hash, 'hash-m1', '补图：哈希写入')

// 用已被占用的哈希会撞唯一索引 —— 主进程必须换一个哈希再写
let threw = false
try {
  setTaskImage(m1.id, 'images/m1b.jpg', 'thumbs/m1b.jpg', 'hash-shot-1')
} catch {
  threw = true
}
ok(threw, '补图：重复哈希会触发唯一约束（所以主进程要换哈希）')

// ---------- 收尾 ----------
const total = pass + fails.length
console.log(`\n用例 ${total} 条：通过 ${pass}，失败 ${fails.length}`)
if (fails.length) {
  console.log('\n失败明细:')
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
}
try {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
} catch {
  /* 忽略 */
}
process.exit(fails.length ? 1 : 0)
