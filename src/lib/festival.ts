import { Lunar, Solar } from 'lunar-javascript'

export interface FestivalItem {
  name: string
  /** 距离今天还有几天，0 = 今天 */
  daysLeft: number
  /** 节日类型：法定假日 / 节气 */
  kind: 'holiday' | 'term'
  /** 具体日期 yyyy-m-d，用于去重和排序 */
  key: string
}

/** 固定日期的法定节日 */
const FIXED: [number, number, string][] = [
  [1, 1, '元旦'],
  [5, 1, '劳动节'],
  [10, 1, '国庆节']
]

/** 按农历算的法定节日 */
const LUNAR_FIXED: [number, number, string][] = [
  [1, 1, '春节'],
  [5, 5, '端午节'],
  [8, 15, '中秋节']
]

const TERMS = new Set([
  '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑',
  '立秋', '处暑', '白露', '秋分', '寒露', '霜降',
  '立冬', '小雪', '大雪', '冬至', '小寒', '大寒'
])

/** 只算放假的节日（清明本身是节气，这里标记为法定假日） */
const LEGAL_TERMS = new Set(['清明'])

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

/**
 * 收集某一年里所有节日（法定 + 节气），跨年时把下一年也算上，
 * 避免年底时"下一个节日"查不到。
 */
function collectYear(year: number): { date: Date; name: string; kind: 'holiday' | 'term' }[] {
  const out: { date: Date; name: string; kind: 'holiday' | 'term' }[] = []

  for (const [m, d, name] of FIXED) {
    out.push({ date: new Date(year, m - 1, d), name, kind: 'holiday' })
  }

  for (const [lm, ld, name] of LUNAR_FIXED) {
    try {
      const solar = Lunar.fromYmd(year, lm, ld).getSolar()
      out.push({
        date: new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay()),
        name,
        kind: 'holiday'
      })
    } catch {
      /* 该年没有这个农历日期，忽略 */
    }
  }

  try {
    // 节气表挂在 Lunar 实例上，用年中任意一天取，能拿到覆盖该年前后的完整表
    const table = Solar.fromYmd(year, 6, 1).getLunar().getJieQiTable() as Record<string, Solar>
    for (const [name, solar] of Object.entries(table)) {
      if (!TERMS.has(name)) continue
      out.push({
        date: new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay()),
        name,
        kind: LEGAL_TERMS.has(name) ? 'holiday' : 'term'
      })
    }
  } catch {
    /* 节气表算不出来就跳过 */
  }

  return out
}

/**
 * 取接下来要显示的节日：
 * - 一周内（含今天）有节日的，全部显示（应对连着的节日）
 * - 否则只显示最近的一个
 */
export function upcomingFestivals(withinDays = 7, today = new Date()): FestivalItem[] {
  const base = startOfDay(today)
  const y = base.getFullYear()

  const all = [...collectYear(y), ...collectYear(y + 1)]
    .map((f) => {
      const date = startOfDay(f.date)
      return {
        name: f.name,
        kind: f.kind,
        daysLeft: diffDays(date, base),
        key: `${f.name}-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
      }
    })
    .filter((f) => f.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)

  // 同一天同名去重（清明既是节气又是法定假日）
  const seen = new Set<string>()
  const uniq = all.filter((f) => {
    const k = `${f.daysLeft}-${f.name}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const soon = uniq.filter((f) => f.daysLeft < withinDays)
  if (soon.length) return soon
  return uniq.slice(0, 1)
}
