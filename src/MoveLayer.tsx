import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface Cat {
  id: string
  name: string
  color: string
}

interface FileItem {
  id: string
  name: string
  path: string
  ext: string
  size: number
  categoryId: string | null
  missing: boolean
}

const COLOR: Record<string, string> = {
  blue: '#4a7dff',
  green: '#30a46c',
  orange: '#f5a524',
  red: '#e5484d',
  yellow: '#d4a017',
  pink: '#d6409f',
  none: '#7a8296'
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}G`
}

export default function MoveLayer() {
  const [cats, setCats] = useState<Cat[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [busy, setBusy] = useState(false)
  const [tip, setTip] = useState('')
  const [root, setRoot] = useState('')
  const [icons, setIcons] = useState<Record<string, string>>({})
  const iconRef = useRef<Record<string, string>>({})

  const load = useCallback(async () => {
    const [c, f] = await Promise.all([
      window.api.files.categories() as Promise<Cat[]>,
      window.api.moveDesk.files() as Promise<FileItem[]>
    ])
    setCats(c)
    setFiles(f)
  }, [])

  useEffect(() => {
    void load()
    void window.api.files.storageRoot().then((r) => setRoot(r as string))
    const t = setInterval(() => void load(), 4000)
    return () => clearInterval(t)
  }, [load])

  // 图标
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const f of files) {
        if (cancelled) return
        if (iconRef.current[f.path]) continue
        const url = (await window.api.desk.icon(f.path, f.ext, false)) as string
        if (url && !cancelled) {
          iconRef.current[f.path] = url
          setIcons({ ...iconRef.current })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [files])

  // 穿透：面板和操作按钮可交互
  useEffect(() => {
    let over = false
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const inside = !!el?.closest('[data-panel], .mv-btn, .mv-bar')
      if (inside !== over) {
        over = inside
        window.api.moveDesk.setInteractive(inside)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.api.moveDesk.setInteractive(false)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void window.api.moveDesk.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function say(m: string) {
    setTip(m)
    window.setTimeout(() => setTip(''), 3600)
  }

  async function doArchive() {
    if (busy) return
    setBusy(true)
    const r = (await window.api.moveDesk.archive()) as {
      moved: { name: string; category: string }[]
      failed: string[]
      scanned: number
    }
    await load()
    setBusy(false)
    if (r.moved.length && r.failed.length) {
      say(`搬走 ${r.moved.length} 个；${r.failed.length} 个搬不动（被程序占用，关掉再试）：${r.failed.slice(0, 2).join('、')}`)
    } else if (r.moved.length) {
      const parts = r.moved.slice(0, 3).map((a) => `${a.name} → ${a.category}`)
      const more = r.moved.length > 3 ? ` 等 ${r.moved.length} 个` : ''
      say(`搬走 ${parts.join('，')}${more}`)
    } else if (r.failed.length) {
      say(`${r.failed.length} 个文件搬不动，可能正被 Excel/WPS 打开：${r.failed.slice(0, 2).join('、')}`)
    } else {
      say('桌面上没有可搬的文件')
    }
  }

  const groups = useMemo(
    () =>
      cats
        .map((c) => ({ cat: c, items: files.filter((f) => f.categoryId === c.id) }))
        .filter((g) => g.items.length > 0),
    [cats, files]
  )

  return (
    <div className="desk">
      {groups.map(({ cat, items }, idx) => {
        const color = COLOR[cat.color] ?? COLOR.none
        return (
          <section
            key={cat.id}
            data-panel={cat.id}
            className="desk-panel mv-panel"
            style={{ left: 24 + (idx % 4) * 248, top: 24 + Math.floor(idx / 4) * 300 }}
          >
            <header className="dp-head" style={{ cursor: 'default' }}>
              <span className="dp-icon" style={{ color }}>
                ▣
              </span>
              <span className="dp-title">{cat.name}</span>
              <span className="dp-count">{items.length}</span>
            </header>

            <div className="dp-body">
              {items.map((f) => (
                <button
                  key={f.id}
                  className="dp-item"
                  title={`${f.name}\n${fmtSize(f.size)}\n已搬到收纳目录`}
                  onDoubleClick={() => void window.api.desk.open(f.path)}
                >
                  {icons[f.path] ? (
                    <img className="dp-ico" src={icons[f.path]} alt="" draggable={false} />
                  ) : (
                    <span className="dp-ext" style={{ background: `${color}26`, color }}>
                      {(f.ext || '?').slice(0, 4).toUpperCase()}
                    </span>
                  )}
                  <span className="dp-name">{f.name}</span>
                </button>
              ))}
            </div>

            <footer className="dp-foot">
              <span className="dp-hint">收纳 · {cat.name}</span>
            </footer>
          </section>
        )
      })}

      <div className="mv-bar">
        <div className="mv-title">
          分区2 · 搬运模式
          <span className="mv-sub">
            {files.length} 个文件在收纳目录里 · 关闭即全部放回
          </span>
        </div>
        <div className="mv-acts">
          <button className="mv-btn" onClick={doArchive} disabled={busy}>
            {busy ? '搬运中…' : '归档桌面'}
          </button>

        </div>
      </div>

      {files.length === 0 && (
        <div className="mv-empty">
          <div className="mv-empty-title">分区2 · 搬运模式</div>
          <div className="mv-empty-sub">
            点右上角「归档桌面」，把桌面上的文件全部搬进收纳目录
            <br />
            关掉分区2 会自动全部放回，文件不会丢
          </div>
        </div>
      )}

      {tip && <div className="desk-tip">{tip}</div>}
      {root && <div className="mv-foot">收纳位置：{root}</div>}
    </div>
  )
}
