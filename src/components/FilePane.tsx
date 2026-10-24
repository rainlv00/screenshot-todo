import { useCallback, useEffect, useMemo, useState } from 'react'

interface Cat {
  id: string
  name: string
  exts: string[]
  color: string
  builtin: boolean
  count: number
}

interface FileItem {
  id: string
  path: string
  name: string
  ext: string
  size: number
  mtime: number
  categoryId: string | null
  pinned: boolean
  missing: boolean
  addedAt: number
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const now = new Date()
  const mm = `${d.getMonth() + 1}`.padStart(2, '0')
  const dd = `${d.getDate()}`.padStart(2, '0')
  return d.getFullYear() === now.getFullYear() ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`
}

const COLOR: Record<string, string> = {
  blue: '#3f6bff',
  green: '#30a46c',
  orange: '#f5a524',
  red: '#e5484d',
  yellow: '#d4a017',
  pink: '#d6409f',
  none: '#8b90a0'
}

export function FilePane() {
  const [cats, setCats] = useState<Cat[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [c, f] = await Promise.all([
      window.api.files.categories() as Promise<Cat[]>,
      window.api.files.list(active) as Promise<FileItem[]>
    ])
    setCats(c)
    setFiles(f)
    setLoading(false)
  }, [active])

  useEffect(() => {
    void load()
  }, [load])

  const total = useMemo(() => cats.reduce((s, c) => s + c.count, 0), [cats])
  const catMap = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats])

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const paths: string[] = []
    for (const f of Array.from(e.dataTransfer.files)) {
      const p = window.api.getPathForFile(f)
      if (p) paths.push(p)
    }
    if (!paths.length) return
    await window.api.files.addPaths(paths)
    await load()
  }

  return (
    <div
      className="fp"
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="fp-cats">
        <button className={`fp-chip ${active === null ? 'on' : ''}`} onClick={() => setActive(null)}>
          全部
          <span>{total}</span>
        </button>
        {cats
          .filter((c) => c.count > 0 || c.builtin)
          .map((c) => (
            <button
              key={c.id}
              className={`fp-chip ${active === c.id ? 'on' : ''}`}
              onClick={() => setActive(c.id)}
              style={{ '--dot': COLOR[c.color] ?? COLOR.none } as React.CSSProperties}
            >
              <i className="fp-dot" />
              {c.name}
              {c.count > 0 && <span>{c.count}</span>}
            </button>
          ))}
      </div>

      <div className="fp-list">
        {loading && <div className="fp-empty">读取中…</div>}

        {!loading && files.length === 0 && (
          <div className="fp-empty">
            <div className="fp-empty-icon">📁</div>
            <div className="fp-empty-title">还没有文件</div>
            <div className="fp-empty-sub">
              把文件拖进来就会出现在这里
              <br />
              <b>只记路径，不会移动你的文件</b>
            </div>
            <button
              className="fp-scan"
              onClick={async () => {
                await window.api.files.scan()
                await load()
              }}
            >
              扫描桌面
            </button>
          </div>
        )}

        {files.map((f) => {
          const c = f.categoryId ? catMap.get(f.categoryId) : null
          const color = COLOR[c?.color ?? 'none']
          return (
            <div
              key={f.id}
              className={`fp-item ${f.missing ? 'is-missing' : ''} ${f.pinned ? 'is-pinned' : ''}`}
              onDoubleClick={() => void window.api.files.open(f.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenuId(menuId === f.id ? null : f.id)
              }}
            >
              <div className="fp-ext" style={{ color, background: `${color}1c` }}>
                {(f.ext || '?').slice(0, 4).toUpperCase()}
              </div>
              <div className="fp-info">
                <div className="fp-name">{f.name}</div>
                <div className="fp-meta">
                  {fmtSize(f.size)} · {fmtDate(f.mtime)}
                  {f.missing && <span className="fp-gone"> · 文件已不在</span>}
                </div>
              </div>
              <button
                className="fp-more"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuId(menuId === f.id ? null : f.id)
                }}
              >
                ⋯
              </button>

              {menuId === f.id && (
                <>
                  <div className="fp-mask" onClick={() => setMenuId(null)} />
                  <div className="fp-menu">
                    <button onClick={() => { void window.api.files.open(f.id); setMenuId(null) }}>打开</button>
                    <button onClick={() => { void window.api.files.reveal(f.id); setMenuId(null) }}>
                      在文件夹中显示
                    </button>
                    <button
                      onClick={async () => {
                        await window.api.files.pin(f.id, !f.pinned)
                        setMenuId(null)
                        await load()
                      }}
                    >
                      {f.pinned ? '取消置顶' : '置顶'}
                    </button>
                    <button
                      className="danger"
                      onClick={async () => {
                        await window.api.files.remove(f.id)
                        setMenuId(null)
                        await load()
                      }}
                    >
                      从柜子移除
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {dragging && <div className="fp-drop">松手收进来</div>}
    </div>
  )
}
