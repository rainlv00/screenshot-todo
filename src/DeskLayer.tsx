import { useCallback, useEffect, useMemo, useState } from 'react'

interface DeskFile {
  name: string
  path: string
  ext: string
  size: number
  mtime: number
  dir: boolean
}

interface PanelDef {
  id: string
  title: string
  exts: string[]
  color: string
}

const PANELS: PanelDef[] = [
  { id: 'doc', title: '文档', exts: ['doc', 'docx', 'pdf', 'txt', 'md', 'rtf', 'wps'], color: '#4a7dff' },
  { id: 'sheet', title: '表格', exts: ['xls', 'xlsx', 'csv', 'et'], color: '#30a46c' },
  { id: 'slide', title: '演示', exts: ['ppt', 'pptx', 'dps'], color: '#f5a524' },
  { id: 'video', title: '视频', exts: ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv'], color: '#d6409f' },
  { id: 'image', title: '图片', exts: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'], color: '#8e6bff' },
  { id: 'archive', title: '压缩包', exts: ['zip', 'rar', '7z', 'tar', 'gz'], color: '#d4a017' },
  { id: 'app', title: '程序', exts: ['exe', 'msi', 'lnk', 'bat'], color: '#e5484d' }
]

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}G`
}

export default function DeskLayer() {
  const [files, setFiles] = useState<DeskFile[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'grid' | 'list'>('grid')

  const load = useCallback(async () => {
    const f = (await window.api.desk.files()) as DeskFile[]
    setFiles(f)
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  // 鼠标在面板上才接管，空白处穿透到桌面
  useEffect(() => {
    let over = false
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const inside = !!el?.closest('[data-panel]')
      if (inside !== over) {
        over = inside
        window.api.desk.setInteractive(inside)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.api.desk.setInteractive(false)
    }
  }, [])

  const groups = useMemo(() => {
    const used = new Set<string>()
    const out = PANELS.map((p) => {
      const items = files.filter((f) => {
        if (used.has(f.path)) return false
        if (f.dir) return false
        if (p.exts.includes(f.ext)) {
          used.add(f.path)
          return true
        }
        return false
      })
      return { panel: p, items }
    })
    // 剩下的归到「其他」
    const rest = files.filter((f) => !used.has(f.path))
    if (rest.length) {
      out.push({ panel: { id: 'other', title: '其他', exts: [], color: '#7a8296' }, items: rest })
    }
    return out.filter((g) => g.items.length > 0)
  }, [files])

  return (
    <div className="desk">
      {groups.map(({ panel, items }, idx) => {
        const isCollapsed = collapsed.has(panel.id)
        const col = idx % 4
        const row = Math.floor(idx / 4)
        return (
          <section
            key={panel.id}
            data-panel={panel.id}
            className={`desk-panel ${isCollapsed ? 'is-collapsed' : ''}`}
            style={{ left: 24 + col * 248, top: 24 + row * 300 }}
          >
            <header className="dp-head">
              <button
                className="dp-fold"
                onClick={() => {
                  const n = new Set(collapsed)
                  if (n.has(panel.id)) n.delete(panel.id)
                  else n.add(panel.id)
                  setCollapsed(n)
                }}
                title={isCollapsed ? '展开' : '收起'}
              >
                {isCollapsed ? '▾' : '▴'}
              </button>
              <span className="dp-icon" style={{ color: panel.color }}>
                ▣
              </span>
              <span className="dp-title">{panel.title}</span>
              <span className="dp-count">{items.length}</span>
              <button className="dp-act" title="更多">
                ⋯
              </button>
            </header>

            {!isCollapsed && (
              <>
                <div className={`dp-body ${view === 'list' ? 'is-list' : ''}`}>
                  {items.map((f) => (
                    <button
                      key={f.path}
                      className="dp-item"
                      title={`${f.name}\n${fmtSize(f.size)}`}
                      onDoubleClick={() => void window.api.desk.open(f.path)}
                    >
                      <span className="dp-ext" style={{ background: `${panel.color}26`, color: panel.color }}>
                        {(f.ext || '?').slice(0, 4).toUpperCase()}
                      </span>
                      <span className="dp-name">{f.name}</span>
                      {view === 'list' && <span className="dp-size">{fmtSize(f.size)}</span>}
                    </button>
                  ))}
                </div>

                <footer className="dp-foot">
                  <span className="dp-hint">桌面 · {panel.title}</span>
                  <button
                    className="dp-view"
                    onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
                    title="切换列表/宫格"
                  >
                    {view === 'grid' ? '▤' : '▦'}
                  </button>
                </footer>
              </>
            )}
          </section>
        )
      })}
    </div>
  )
}
