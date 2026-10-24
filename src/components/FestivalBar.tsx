import { useEffect, useMemo, useState } from 'react'
import { upcomingFestivals } from '../lib/festival'

export function FestivalBar({ onOpen }: { onOpen: () => void }) {
  const [today, setToday] = useState(() => new Date())

  // 跨天自动刷新
  useEffect(() => {
    const t = setInterval(() => setToday(new Date()), 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const items = useMemo(() => upcomingFestivals(7, today), [today])

  if (!items.length) return null

  return (
    <button className="festival-bar" onClick={onOpen} title="点开日历查看节日">
      <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true" className="festival-icon">
        <rect x="3" y="4.2" width="14" height="12.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 8h14" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 2.6v3M13 2.6v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {items.map((f, i) => (
        <span key={f.key} className={`festival-item ${f.kind === 'holiday' ? 'is-holiday' : ''}`}>
          {i > 0 && <span className="festival-sep">·</span>}
          <span className="festival-days">
            离 <b className="festival-name">{f.name}</b> 还有 <b>{f.daysLeft === 0 ? '今天' : `${f.daysLeft} 天`}</b>
          </span>
        </span>
      ))}
    </button>
  )
}
