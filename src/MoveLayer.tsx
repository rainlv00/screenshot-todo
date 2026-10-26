import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWindowShape } from './useWindowShape'

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
  const [animating, setAnimating] = useState(false)
  const [style, setStyle] = useState<Record<string, PanelStyle>>(loadStyle)
  const [menuCat, setMenuCat] = useState<string | null>(null)
  const [fileMenu, setFileMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renameOpen, setRenameOpen] = useState<{ id: string; name: string } | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [tip, setTip] = useState('')
  const [icons, setIcons] = useState<Record<string, string>>({})
  const iconRef = useRef<Record<string, string>>({})
  const iconPending = useRef<Set<string>>(new Set())
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newExts, setNewExts] = useState('')
  const dragFileId = useRef<string | null>(null)

  const load = useCallback(async () => {
    const [c, list] = await Promise.all([
      window.api.files.categories() as Promise<Cat[]>,
      window.api.moveDesk.files() as Promise<DeskFile[]>
    ])
    setCats(c)
    setFiles(list)
  }, [])

  useEffect(() => window.api.moveDesk.onRefreshed(() => void load()), [load])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 6000)
    return () => clearInterval(t)
  }, [load])

  // 逐个取真实图标（图片出缩略图），异步补上不影响首屏
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const f of files) {
        if (cancelled) return
        if (iconRef.current[f.path] || iconPending.current.has(f.path)) continue
        iconPending.current.add(f.path)
        try {
          const url = (await window.api.desk.icon(f.path, f.ext, false)) as string
          if (url && !cancelled) {
            iconRef.current[f.path] = url
            setIcons({ ...iconRef.current })
          }
        } finally {
          iconPending.current.delete(f.path)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [files])

  // ESC 是逃生口：不管卡在哪，按一下就能收起桌面层
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (newOpen) setNewOpen(false)
      else if (menuCat) setMenuCat(null)
      else void window.api.moveDesk.close()
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
    setAnimating(true)

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
      setAnimating(false)
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
    setAnimating(true)
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setAnimating(false)
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

  async function doRename() {
    const name = renameVal.trim()
    if (!renameOpen || !name) return
    await window.api.files.renameCategory(renameOpen.id, name)
    setRenameOpen(null)
    await load()
  }

  const visible = useMemo(
    () =>
      cats
        .map((c) => ({ cat: c, items: files.filter((f) => f.categoryId === c.id) }))
        .filter((g) => g.items.length > 0),
    [cats, files]
  )

  // 窗口形状 = 面板 + 工具条 + 新建按钮，形状外交给系统穿透
  useWindowShape(
    (rects) => window.api.desk.setShape(rects),
    [visible, pos, style, collapsed, newOpen, menuCat, animating],
    newOpen || menuCat !== null || animating
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
            data-shape="1"
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
              e.dataTransfer.dropEffect = 'move'
              setDragOverCat(cat.id)
            }}
            onDragLeave={() => setDragOverCat((v) => (v === cat.id ? null : v))}
            onDrop={async (e) => {
              e.preventDefault()
              setDragOverCat(null)
              const paths: string[] = []
              for (const f of Array.from(e.dataTransfer.files)) {
                const fp = window.api.getPathForFile(f)
                if (fp) paths.push(fp)
              }
              if (!paths.length) {
                // 不是外部文件，可能是面板之间拖拽改分类
                void dropToCategory(cat.id)
                return
              }
              const r = (await window.api.moveDesk.add(paths)) as {
                moved: { name: string; category: string }[]
                failed: string[]
              }
              await load()
              if (r.moved.length) {
                const parts = r.moved.slice(0, 3).map((a) => `${a.name} → ${a.category}`)
                setTip(`收进来 ${parts.join('，')}${r.failed.length ? `；${r.failed.length} 个失败` : ''}`)
              } else if (r.failed.length) {
                setTip(`${r.failed.length} 个搬不动，可能正被 Excel/WPS 打开`)
              }
              window.setTimeout(() => setTip(''), 1800)
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
                        // 按住 Alt 拖 = 原生拖到桌面/资源管理器；直接拖 = 面板之间改分类
                        if (e.altKey) {
                          e.preventDefault()
                          window.api.moveDesk.dragOut(f.id)
                          return
                        }
                        dragFileId.current = f.id
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', f.id)
                      }}
                      title={`${f.name}\n${fmtSize(f.size)}\n双击打开 · 拖到别的分区改分类 · 按住 Alt 拖到桌面`}
                      onDoubleClick={() => void window.api.desk.open(f.path)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setFileMenu({ id: f.id, x: e.clientX, y: e.clientY })
                      }}
                    >
                      {icons[f.path] ? (
                        <img className="dp-ico" src={icons[f.path]} alt="" draggable={false} />
                      ) : (
                        <span className="dp-ext" style={{ background: `${color}26`, color }}>
                          {(f.ext || '?').slice(0, 4).toUpperCase()}
                        </span>
                      )}
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

      {visible.length === 0 && (
        <div
          className={`mv-empty ${dragOverCat === 'empty' ? 'is-over' : ''}`}
          data-shape="1"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDragOverCat('empty')
          }}
          onDragLeave={() => setDragOverCat((v) => (v === 'empty' ? null : v))}
          onDrop={async (e) => {
            e.preventDefault()
            setDragOverCat(null)
            const paths: string[] = []
            for (const f of Array.from(e.dataTransfer.files)) {
              const fp = window.api.getPathForFile(f)
              if (fp) paths.push(fp)
            }
            if (!paths.length) return
            const r = (await window.api.moveDesk.add(paths)) as {
              moved: { name: string; category: string }[]
              failed: string[]
            }
            await load()
            if (r.moved.length) {
              const parts = r.moved.slice(0, 3).map((a) => `${a.name} → ${a.category}`)
              setTip(`收进来 ${parts.join('，')}${r.failed.length ? `；${r.failed.length} 个失败` : ''}`)
            } else if (r.failed.length) {
              setTip(`${r.failed.length} 个搬不动，可能正被 Excel/WPS 打开`)
            }
            window.setTimeout(() => setTip(''), 1800)
          }}
        >
          <div className="mv-empty-box">
            <div className="mv-empty-title">把桌面文件拖到这里</div>
            <div className="mv-empty-sub">
              拖进来就会收进分区，按类型自动分好
              <br />
              关掉分区会自动全部放回，文件不会丢
            </div>
          </div>
        </div>
      )}

      {renameOpen && (
        <div className="desk-modal-mask" onClick={() => setRenameOpen(null)}>
          <div className="desk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dm-title">重命名分区</div>
            <input
              autoFocus
              className="dm-input"
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doRename()
                if (e.key === 'Escape') setRenameOpen(null)
              }}
            />
            <div className="dm-actions">
              <button className="dm-btn" onClick={() => setRenameOpen(null)}>
                取消
              </button>
              <button className="dm-btn primary" onClick={doRename} disabled={!renameVal.trim()}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {fileMenu && (
        <>
          <div
            className="dm-file-mask"
            onClick={() => setFileMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setFileMenu(null)
            }}
          />
          <div
            className="dm-file-menu"
            style={{
              left: Math.min(fileMenu.x, window.innerWidth - 150),
              top: Math.min(fileMenu.y, window.innerHeight - 130)
            }}
          >
            <button
              onClick={() => {
                void window.api.desk.open(files.find((f) => f.id === fileMenu.id)?.path || '')
                setFileMenu(null)
              }}
            >
              打开
            </button>
            <button
              onClick={() => {
                void window.api.desk.reveal(files.find((f) => f.id === fileMenu.id)?.path || '')
                setFileMenu(null)
              }}
            >
              在文件夹中显示
            </button>
            <button
              onClick={async () => {
                const ok = await window.api.moveDesk.restore(fileMenu.id)
                setFileMenu(null)
                await load()
                setTip(ok ? '已放回桌面' : '放回失败，文件可能被移动了')
                window.setTimeout(() => setTip(''), 1800)
              }}
            >
              放回桌面
            </button>
          </div>
        </>
      )}

      {tip && <div className="desk-tip">{tip}</div>}

      {menuCat && (
        <div className="desk-modal-mask" onClick={() => setMenuCat(null)}>
          <div className="desk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dm-title">分区设置</div>
            <button
              className="dm-newcat"
              onClick={() => {
                setMenuCat(null)
                setNewOpen(true)
              }}
            >
              + 新建分区
            </button>
            <button
              className="dm-newcat"
              onClick={() => {
                const c = cats.find((x) => x.id === menuCat)
                setMenuCat(null)
                setRenameOpen({ id: menuCat!, name: c?.name ?? '' })
                setRenameVal(c?.name ?? '')
              }}
            >
              ✎ 重命名分区
            </button>
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
