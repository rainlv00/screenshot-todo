import { useCallback, useEffect, useState } from 'react'

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
  origPath: string
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

const COLOR: Record<string, string> = {
  blue: '#3f6bff',
  green: '#30a46c',
  orange: '#f5a524',
  red: '#e5484d',
  yellow: '#d4a017',
  pink: '#d6409f',
  none: '#8b90a0'
}

export default function FileCabinet() {
  const [cats, setCats] = useState<Cat[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [root, setRoot] = useState('')
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const [c, f] = await Promise.all([
      window.api.files.categories() as Promise<Cat[]>,
      window.api.files.list(null) as Promise<FileItem[]>
    ])
    setCats(c)
    setFiles(f)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    void window.api.files.storageRoot().then((r) => setRoot(r as string))
  }, [load])

  function say(m: string) {
    setToast(m)
    window.setTimeout(() => setToast(''), 2400)
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const paths: string[] = []
    for (const f of Array.from(e.dataTransfer.files)) {
      const p = window.api.getPathForFile(f)
      if (p) paths.push(p)
    }
    if (!paths.length) return
    const n = await window.api.files.addPaths(paths)
    await load()
    say(n > 0 ? `已收纳 ${n} 个文件` : '这些文件已经在柜子里了')
  }

  // 有内容的分类才出卡片
  const groups = cats.filter((c) => c.count > 0).map((c) => ({
    cat: c,
    items: files.filter((f) => f.categoryId === c.id)
  }))
  const orphans = files.filter((f) => !cats.some((c) => c.id === f.categoryId && c.count > 0))

  return (
    <div
      className={`fc ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <header className="fc-head">
        <div>
          <div className="fc-title">文件柜</div>
          <div className="fc-path" title={root}>
            收纳在 {root || '…'}
          </div>
        </div>
        <div className="fc-actions">
          <button
            className="fc-btn"
            onClick={async () => {
              const r = await window.api.files.scan()
              await load()
              say(r.added > 0 ? `收纳了 ${r.added} 个文件` : '没有发现新文件')
            }}
          >
            扫描桌面
          </button>
          <button
            className="fc-btn"
            onClick={async () => {
              const res = (await window.api.files.closeAndRestore()) as {
                restored: number
                failed: number
                cancelled: boolean
              }
              if (!res.cancelled) say(`已还原 ${res.restored} 个文件${res.failed ? `，${res.failed} 个失败` : ''}`)
            }}
          >
            全部还原
          </button>
        </div>
      </header>

      <main className="fc-body">
        {loading && <div className="fc-empty">读取中…</div>}

        {!loading && files.length === 0 && (
          <div className="fc-empty">
            <div className="fc-empty-icon">🗂️</div>
            <div className="fc-empty-title">柜子是空的</div>
            <div className="fc-empty-sub">
              把文件拖进来，它们会被<b>移动</b>到这里
              <br />
              关掉文件柜时自动放回原位
            </div>
          </div>
        )}

        {groups.map(({ cat, items }) => {
          const color = COLOR[cat.color] ?? COLOR.none
          const isCollapsed = collapsed.has(cat.id)
          return (
            <section key={cat.id} className="fc-card">
              <div
                className="fc-card-head"
                onClick={() => {
                  const next = new Set(collapsed)
                  if (next.has(cat.id)) next.delete(cat.id)
                  else next.add(cat.id)
                  setCollapsed(next)
                }}
              >
                <span className="fc-dot" style={{ background: color }} />
                <span className="fc-card-name">{cat.name}</span>
                <span className="fc-card-count">{items.length}</span>
                <span className="fc-caret">{isCollapsed ? '▸' : '▾'}</span>
              </div>

              {!isCollapsed && (
                <div className="fc-card-body">
                  {items.map((f) => (
                    <div key={f.id} className={`fc-row ${f.missing ? 'is-missing' : ''}`}>
                      <div className="fc-ext" style={{ color, background: `${color}1c` }}>
                        {(f.ext || '?').slice(0, 4).toUpperCase()}
                      </div>
                      <div className="fc-row-info">
                        <div className="fc-row-name" title={f.path}>
                          {f.name}
                        </div>
                        <div className="fc-row-meta">
                          {fmtSize(f.size)} · 原位置 {f.origPath.replace(/^.*[\\/]/, '') ? '桌面' : '未知'}
                        </div>
                      </div>
                      <div className="fc-row-act">
                        <button onClick={() => void window.api.files.open(f.id)} title="打开">
                          打开
                        </button>
                        <button
                          onClick={async () => {
                            const ok = await window.api.files.restoreOne(f.id)
                            await load()
                            say(ok ? '已放回原位置' : '还原失败，文件可能已被移动')
                          }}
                          title="放回原位置"
                        >
                          放回
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}

        {orphans.length > 0 && (
          <section className="fc-card">
            <div className="fc-card-head">
              <span className="fc-dot" style={{ background: '#8b90a0' }} />
              <span className="fc-card-name">未分类</span>
              <span className="fc-card-count">{orphans.length}</span>
            </div>
          </section>
        )}
      </main>

      {dragging && <div className="fc-drop">松手就收进柜子</div>}
      {toast && <div className="fc-toast">{toast}</div>}
    </div>
  )
}
