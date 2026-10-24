import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface Cat {
  id: string
  name: string
  exts: string[]
  color: string
  builtin: boolean
  count: number
}

interface DeskFile {
  id: string
  name: string
  path: string
  ext: string
  size: number
  mtime: number
  categoryId: string | null
  pinned: boolean
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

const POS_KEY = 'desk-panel-pos'
const STYLE_KEY = 'desk-panel-style'

/** 预设色板，面板和分区共用 */
const SWATCHES = ['blue', 'green', 'orange', 'red', 'yellow', 'pink', 'none']

interface PanelStyle {
  color?: string
  width?: number
  height?: number
  alpha?: number
  locked?: boolean
}

function loadStyle(): Record<string, PanelStyle> {
  try {
    return JSON.parse(localStorage.getItem(STYLE_KEY) || '{}')
  } catch {
    return {}
  }
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}G`
}

type Pos = { x: number; y: number }

export default function DeskLayer() {
  const [cats, setCats] = useState<Cat[]>([])
  const [files, setFiles] = useState<DeskFile[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [pos, setPos] = useState<Record<string, Pos>>(() => {
    try {
      return JSON.parse(localStorage.getItem(POS_KEY) || '{}')
    } catch {
      return {}
    }
  })
  const [dragOverCat, setDragOverCat] = useState<string | null>(null)
  const [style, setStyle] = useState<Record<string, PanelStyle>>(loadStyle)
  const [menuCat, setMenuCat] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newExts, setNewExts] = useState('')
  const dragFileId = useRef<string | null>(null)

  const load = useCallback(async () => {
    const [c, f] = await Promise.all([
      window.api.files.categories() as Promise<Cat[]>,
      window.api.desk.files() as Promise<DeskFile[]>
    ])
    setCats(c)
    setFiles(f)
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 6000)
    return () => clearInterval(t)
  }, [load])

  // 鼠标在面板/弹层/按钮上才接管，空白处穿透到桌面
  useEffect(() => {
    // 弹层开着的时候必须整窗可交互，否则点不到（会把整个桌面卡住）
    if (newOpen || menuCat) {
      window.api.desk.setInteractive(true)
      return
    }
    let over = false
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const inside = !!el?.closest('[data-panel], .desk-add')
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
  }, [newOpen, menuCat])

  // ESC 是逃生口：不管卡在哪，按一下就能收起桌面层
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (newOpen) setNewOpen(false)
      else if (menuCat) setMenuCat(null)
      else void window.api.desk.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newOpen, menuCat])

  /** 拖动面板 */
  function startDragPanel(e: React.PointerEvent, id: string) {
    if (style[id]?.locked) return
    if ((e.target as HTMLElement).closest('button')) return
    const startX = e.clientX
    const startY = e.clientY
    const origin = pos[id] ?? { x: 24, y: 24 }
    const baseX = origin.x
    const baseY = origin.y
    let moved = false

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      moved = true
      setPos((cur) => ({
        ...cur,
        [id]: {
          x: Math.max(0, Math.min(window.innerWidth - 240, baseX + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 80, baseY + dy))
        }
      }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) {
        setPos((cur) => {
          try {
            localStorage.setItem(POS_KEY, JSON.stringify(cur))
          } catch {
            /* 存储失败不影响使用 */
          }
          return cur
        })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** 八方向拉伸：dir 是 n/s/e/w/ne/nw/se/sw 组合 */
  function startResize(e: React.PointerEvent, id: string, dir: string) {
    e.stopPropagation()
    e.preventDefault()
    const panel = (e.currentTarget as HTMLElement).closest('.desk-panel') as HTMLElement | null
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const b = { w: rect.width, h: rect.height, x: rect.left, y: rect.top }

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      let w = b.w
      let h = b.h
      let x = b.x
      let y = b.y

      if (dir.includes('e')) w = Math.max(150, Math.min(720, b.w + dx))
      if (dir.includes('s')) h = Math.max(74, Math.min(760, b.h + dy))
      if (dir.includes('w')) {
        w = Math.max(150, Math.min(720, b.w - dx))
        x = b.x + (b.w - w)
      }
      if (dir.includes('n')) {
        h = Math.max(74, Math.min(760, b.h - dy))
        y = b.y + (b.h - h)
      }

      patchStyle(id, { width: Math.round(w), height: Math.round(h) })
      setPos((cur) => {
        const next = { ...cur, [id]: { x: Math.round(Math.max(0, x)), y: Math.round(Math.max(0, y)) } }
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(next))
        } catch {
          /* 忽略 */
        }
        return next
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** 把文件拖到另一个分区 */
  async function dropToCategory(catId: string) {
    const id = dragFileId.current
    dragFileId.current = null
    setDragOverCat(null)
    if (!id) return
    await window.api.files.setCategory(id, catId)
    await load()
  }

  async function createCategory() {
    const name = newName.trim()
    if (!name) return
    const list = newExts
      .split(/[,，\s]+/)
      .map((x) => x.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean)
    await window.api.files.addCategory(name, list)
    setNewOpen(false)
    setNewName('')
    setNewExts('')
    await load()
  }

  function patchStyle(id: string, patch: PanelStyle) {
    setStyle((cur) => {
      const next = { ...cur, [id]: { ...cur[id], ...patch } }
      try {
        localStorage.setItem(STYLE_KEY, JSON.stringify(next))
      } catch {
        /* 忽略 */
      }
      return next
    })
  }

  const visible = useMemo(
    () =>
      cats
        .map((c) => ({ cat: c, items: files.filter((f) => f.categoryId === c.id) }))
        .filter((g) => g.items.length > 0),
    [cats, files]
  )

  return (
    <div className="desk">
      {visible.map(({ cat, items }, idx) => {
        const st = style[cat.id] ?? {}
        const colorKey = st.color ?? cat.color
        const color = COLOR[colorKey] ?? COLOR.none
        const width = st.width ?? 226
        const height = st.height
        const alpha = st.alpha ?? 0.72
        const locked = !!st.locked
        const isCollapsed = collapsed.has(cat.id)
        const p = pos[cat.id] ?? { x: 24 + (idx % 4) * (width + 22), y: 24 + Math.floor(idx / 4) * 300 }
        return (
          <section
            key={cat.id}
            data-panel={cat.id}
            className={`desk-panel ${isCollapsed ? 'is-collapsed' : ''} ${
              dragOverCat === cat.id ? 'is-over' : ''
            } ${locked ? 'is-locked' : ''}`}
            style={{
              left: p.x,
              top: p.y,
              width,
              height,
              background: `rgba(28, 32, 42, ${alpha})`,
              borderColor: colorKey === 'none' ? undefined : `${color}55`
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverCat(cat.id)
            }}
            onDragLeave={() => setDragOverCat((v) => (v === cat.id ? null : v))}
            onDrop={(e) => {
              e.preventDefault()
              void dropToCategory(cat.id)
            }}
          >
            <header
              className="dp-head"
              onPointerDown={(e) => startDragPanel(e, cat.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenuCat(cat.id)
              }}
              title="按住拖动整个面板，右键改样式"
            >
              <button
                className="dp-fold"
                onClick={() => {
                  const n = new Set(collapsed)
                  if (n.has(cat.id)) n.delete(cat.id)
                  else n.add(cat.id)
                  setCollapsed(n)
                }}
                title={isCollapsed ? '展开' : '收起'}
              >
                {isCollapsed ? '▾' : '▴'}
              </button>
              <span className="dp-icon" style={{ color }}>
                ▣
              </span>
              <span className="dp-title">{cat.name}</span>
              <span className="dp-count">{items.length}</span>
              {locked && <span className="dp-lock" title="已锁定，位置和大小不会变">🔒</span>}
              <button className="dp-act" title="分区设置" onClick={() => setMenuCat(menuCat === cat.id ? null : cat.id)}>
                ⋯
              </button>
            </header>

            {!isCollapsed && (
              <>
                <div
                  className={`dp-body ${view === 'list' ? 'is-list' : ''}`}
                  style={height ? { maxHeight: undefined, flex: '1 1 auto' } : undefined}
                >
                  {items.map((f) => (
                    <button
                      key={f.id}
                      className="dp-item"
                      draggable
                      onDragStart={(e) => {
                        dragFileId.current = f.id
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', f.id)
                      }}
                      title={`${f.name}\n${fmtSize(f.size)}\n双击打开，可拖到其它分区`}
                      onDoubleClick={() => void window.api.desk.open(f.path)}
                    >
                      <span className="dp-ext" style={{ background: `${color}26`, color }}>
                        {(f.ext || '?').slice(0, 4).toUpperCase()}
                      </span>
                      <span className="dp-name">{f.name}</span>
                      {view === 'list' && <span className="dp-size">{fmtSize(f.size)}</span>}
                    </button>
                  ))}
                </div>

                <footer className="dp-foot">
                  <span className="dp-hint">桌面 · {cat.name}</span>
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
            {!locked && !isCollapsed && (
              <>
                {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((d) => (
                  <span
                    key={d}
                    className={`dp-h dp-${d}`}
                    onPointerDown={(e) => startResize(e, cat.id, d)}
                  />
                ))}
              </>
            )}
          </section>
        )
      })}

      <button
        className="desk-add"
        style={{
          left: 24 + (visible.length % 4) * 248,
          top: 24 + Math.floor(visible.length / 4) * 300
        }}
        onClick={() => setNewOpen(true)}
        title="新建分区"
      >
        + 新建分区
      </button>

      {menuCat && (
        <div className="desk-modal-mask" onClick={() => setMenuCat(null)}>
          <div className="desk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dm-title">分区样式</div>
            <label className="dm-label">颜色</label>
            <div className="dm-swatches">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  className={`dm-sw ${(style[menuCat]?.color ?? cats.find((x) => x.id === menuCat)?.color) === c ? 'on' : ''}`}
                  style={{ background: COLOR[c] }}
                  title={c}
                  onClick={() => patchStyle(menuCat, { color: c })}
                />
              ))}
            </div>
            <label className="dm-label">锁定</label>
            <div className="dm-seg">
              <button
                className={!style[menuCat]?.locked ? 'on' : ''}
                onClick={() => patchStyle(menuCat, { locked: false })}
              >
                可拖动
              </button>
              <button
                className={style[menuCat]?.locked ? 'on' : ''}
                onClick={() => patchStyle(menuCat, { locked: true })}
              >
                锁定位置和大小
              </button>
            </div>

            <label className="dm-label">背景不透明度</label>
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round((style[menuCat]?.alpha ?? 0.72) * 100)}
              onChange={(e) => patchStyle(menuCat, { alpha: Number(e.target.value) / 100 })}
              className="dm-range"
            />
            <div className="dm-actions">
              <button className="dm-btn" onClick={() => setMenuCat(null)}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {newOpen && (
        <div className="desk-modal-mask" onClick={() => setNewOpen(false)}>
          <div className="desk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dm-title">新建分区</div>
            <label className="dm-label">分区名字</label>
            <input
              autoFocus
              className="dm-input"
              value={newName}
              placeholder="比如：合同、报价单、设计稿"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createCategory()
                if (e.key === 'Escape') setNewOpen(false)
              }}
            />
            <label className="dm-label">自动归类的扩展名（可留空）</label>
            <input
              className="dm-input"
              value={newExts}
              placeholder="如 docx,pdf  留空则只手动拖入"
              onChange={(e) => setNewExts(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createCategory()
              }}
            />
            <div className="dm-actions">
              <button className="dm-btn" onClick={() => setNewOpen(false)}>
                取消
              </button>
              <button className="dm-btn primary" onClick={createCategory} disabled={!newName.trim()}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
