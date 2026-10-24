import { useMemo, useState } from 'react'
import { festivalsOfYear } from '../lib/festival'

interface Props {
  onClose: () => void
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function CalendarModal({ onClose }: Props) {
  const today = new Date()
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))

  const year = cursor.getFullYear()
  const month = cursor.getMonth()

  // 当年节日按 天 建索引，方便按格子查
  const byDay = useMemo(() => {
    const m = new Map<string, { name: string; kind: 'holiday' | 'term' }[]>()
    for (const f of festivalsOfYear(year)) {
      const k = ymd(f.date)
      const arr = m.get(k) ?? []
      // 同一天既过节又过节气时，节日优先显示
      if (!arr.some((x) => x.name === f.name)) arr.push({ name: f.name, kind: f.kind })
      m.set(k, arr)
    }
    // 节日排在节气前面
    for (const [k, arr] of m) m.set(k, arr.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'holiday' ? -1 : 1)))
    return m
  }, [year])

  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const startPad = first.getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const prevDays = new Date(year, month, 0).getDate()

    const out: { date: Date; dim: boolean }[] = []
    for (let i = startPad - 1; i >= 0; i--) {
      out.push({ date: new Date(year, month - 1, prevDays - i), dim: true })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ date: new Date(year, month, d), dim: false })
    }
    while (out.length % 7 !== 0) {
      const last = out[out.length - 1].date
      out.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), dim: true })
    }
    return out
  }, [year, month])

  const todayKey = ymd(today)

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="calendar" onClick={(e) => e.stopPropagation()}>
        <div className="cal-head-row">
          <button className="cal-nav" onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="上个月">
            ‹
          </button>
          <div className="cal-month">
            {year} 年 {month + 1} 月
          </div>
          <button className="cal-nav" onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="下个月">
            ›
          </button>
        </div>

        <div className="cal-week">
          {WEEK.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className="cal-grid">
          {cells.map(({ date, dim }) => {
            const key = ymd(date)
            const fs = byDay.get(key)
            return (
              <div key={key} className={`cal-cell ${dim ? 'dim' : ''} ${key === todayKey ? 'today' : ''}`}>
                <span className="cal-day">{date.getDate()}</span>
                {fs?.slice(0, 2).map((f) => (
                  <span key={f.name} className={`cal-fest ${f.kind === 'term' ? 'term' : ''}`}>
                    {f.name}
                  </span>
                ))}
              </div>
            )
          })}
        </div>

        <div className="cal-legend">
          <span>
            <i className="h" />
            法定节日
          </span>
          <span>
            <i className="t" />
            二十四节气
          </span>
        </div>
      </div>
    </div>
  )
}
