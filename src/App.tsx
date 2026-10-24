import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MarkColor, ListResult, Prefs, Task } from '../shared/types'
import { TaskCard } from './components/TaskCard'
import { GridCard } from './components/GridCard'
import { Preview } from './components/Preview'
import { SettingsModal } from './components/SettingsModal'
import { TopBar } from './components/TopBar'
import { HelpModal } from './components/HelpModal'
import { UpdateButton } from './components/UpdateButton'
import { FestivalBar } from './components/FestivalBar'
import { CalendarModal } from './components/CalendarModal'
import { BgCropper } from './components/BgCropper'
import { dateText, dayKey } from './lib/format'
import { prettyAccel } from './components/HotkeyField'

type Tab = 'pending' | 'done'

const DEFAULT_PREFS: Prefs = {
  dailyRemindAt: '08:30',
  dailyRemindEnabled: true,
  clipboardWatch: true,
  autostart: false,
  alwaysOnTop: true,
  locked: false,
  panelAlpha: 0.94,
  bgColor: 'white',
  bgDim: 0.5,
  bgImage: '',
  bgFit: 'contain',
  pausedUntil: 0,
  pauseMinutes: 15,
  view: 'list',
  fontSize: 'normal',
  textTone: 'auto',
  hotkeyCapture: 'Ctrl+Alt+V',
  hotkeyPause: 'Ctrl+Alt+J'
}

const DARK_COLORS = new Set(['gray', 'black', 'blue', 'green'])

export default function App() {
  const [data, setData] = useState<ListResult>({ pending: [], done: [], pendingCount: 0 })
  const [tab, setTab] = useState<Tab>('pending')
  const [preview, setPreview] = useState<Task | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [cropping, setCropping] = useState<{ file: string; width: number; height: number } | null>(null)
  const [calOpen, setCalOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [bgVer, setBgVer] = useState(1)
  const [loaded, setLoaded] = useState(false)
  const [flash, setFlash] = useState('')
  const [now, setNow] = useState(Date.now())
  const prevBg = useRef('')

  const refresh = useCallback(async () => {
    const r = await window.api.list()
    setData(r)
    setLoaded(true)
  }, [])

  const applyPrefs = useCallback((p: Prefs) => {
    setPrefs(p)
    if (p.bgImage !== prevBg.current) {
      prevBg.current = p.bgImage
      setBgVer(Date.now())
    }
  }, [])

  const updatePrefs = useCallback(
    async (patch: Partial<Prefs>) => {
      const next = await window.api.setPrefs(patch)
      applyPrefs(next)
    },
    [applyPrefs]
  )

  useEffect(() => {
    window.api.getPrefs().then(applyPrefs)
  }, [applyPrefs])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 跨天时"今日新增/积压"要重新分组，一分钟刷一次就够
  useEffect(() => {
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [refresh])

  // 暂停倒计时要跳秒
  useEffect(() => {
    if (!prefs.pausedUntil) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [prefs.pausedUntil])

  useEffect(() => window.api.onChanged(refresh), [refresh])
  useEffect(() => window.api.onOpenSettings(() => setSettingsOpen(true)), [])
  useEffect(() => window.api.onPrefsChanged(applyPrefs), [applyPrefs])

  // 开发期截图用：允许外部直接打开裁剪器
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__openHelp = () => setHelpOpen(true)
    ;(window as unknown as Record<string, unknown>).__openCropper = (
      file: string,
      width: number,
      height: number
    ) => setCropping({ file, width, height })
  }, [])

  // 拖图片文件进来也能收
  useEffect(() => {
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    async function onDrop(e: DragEvent) {
      if (!e.dataTransfer?.files?.length) return
      e.preventDefault()
      let added = 0
      for (const f of Array.from(e.dataTransfer.files)) {
        if (!f.type.startsWith('image/')) continue
        if (f.size > 25 * 1024 * 1024) continue
        const buf = new Uint8Array(await f.arrayBuffer())
        if (await window.api.importBuffer(buf)) added++
      }
      say(added > 0 ? `已收录 ${added} 张` : '没有新的图片')
      refresh()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [refresh])

  function say(msg: string) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 2200)
  }

  async function toggle(task: Task) {
    const toDone = task.status === 'pending'
    setData((prev) => {
      if (toDone) {
        return {
          pending: prev.pending.filter((t) => t.id !== task.id),
          done: [{ ...task, status: 'done', completedAt: Math.floor(Date.now() / 1000) }, ...prev.done],
          pendingCount: Math.max(0, prev.pendingCount - 1)
        }
      }
      return {
        pending: [{ ...task, status: 'pending', completedAt: null, reopenCount: task.reopenCount + 1 }, ...prev.pending],
        done: prev.done.filter((t) => t.id !== task.id),
        pendingCount: prev.pendingCount + 1
      }
    })
    await window.api.setDone(task.id, toDone)
    refresh()
  }

  async function changeTitle(task: Task, title: string) {
    await window.api.setTitle(task.id, title)
    refresh()
  }

  async function changeDue(task: Task, dueAt: number | null) {
    await window.api.setDue(task.id, dueAt)
    refresh()
  }

  async function removeTask(task: Task) {
    setData((prev) => ({
      pending: prev.pending.filter((t) => t.id !== task.id),
      done: prev.done.filter((t) => t.id !== task.id),
      pendingCount: task.status === 'pending' ? Math.max(0, prev.pendingCount - 1) : prev.pendingCount
    }))
    await window.api.removeTask(task.id)
    refresh()
  }

  async function pasteNow() {
    const ok = await window.api.pasteNow()
    say(ok ? '已收录' : '剪贴板里没有新图片')
    refresh()
  }

  async function resume() {
    await updatePrefs({ pausedUntil: 0 })
    say('已恢复自动收录')
  }

  function onDragStart(id: string) {
    setDragId(id)
  }

  function onDragOver(e: React.DragEvent, id: string) {
    if (!dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== overId) setOverId(id)
  }

  function onDrop(e: React.DragEvent, id: string) {
    e.preventDefault()
    const from = dragId
    setDragId(null)
    setOverId(null)
    if (!from || from === id) return
    const fromTask = data.pending.find((t) => t.id === from)
    const toTask = data.pending.find((t) => t.id === id)
    if (!fromTask || !toTask) return
    if (fromTask.pinned || toTask.pinned) {
      say('置顶的待办不参与排序，先取消置顶')
      return
    }
    const ids = data.pending.map((t) => t.id)
    const i = ids.indexOf(from)
    const j = ids.indexOf(id)
    if (i < 0 || j < 0) return
    const [moved] = ids.splice(i, 1)
    // 删除后目标索引会前移，往下拖时要减一，才能真正落到目标位置
    ids.splice(i < j ? j - 1 : j, 0, moved)
    void window.api.reorder(ids)
  }

  function onDragEnd() {
    setDragId(null)
    setOverId(null)
  }

  async function togglePin(t: Task) {
    await window.api.setPinned(t.id, !t.pinned)
    say(t.pinned ? '已取消置顶' : '已置顶')
  }

  async function markColor(t: Task, color: MarkColor) {
    await window.api.setColor(t.id, color)
  }

  /** 收录总闸：开 = 关掉暂停；关 = 停止自动收录并清掉暂停 */
  async function toggleCapture() {
    if (capturing) {
      await updatePrefs({ clipboardWatch: false, pausedUntil: 0 })
      say('已停止自动收录')
    } else {
      await updatePrefs({ clipboardWatch: true, pausedUntil: 0 })
      say('已开启自动收录')
    }
  }

  async function pickBg() {
    const r = await window.api.pickBackgroundRaw()
    if (r) setCropping(r)
  }

  async function clearBg() {
    const next = await window.api.clearBackground()
    applyPrefs(next)
    say('已清除背景图')
  }

  const today = useMemo(() => data.pending.filter((t) => t.daysHeld === 0), [data.pending])
  const backlog = useMemo(
    () => data.pending.filter((t) => t.daysHeld >= 1).sort((a, b) => a.createdAt - b.createdAt),
    [data.pending]
  )

  const doneGroups = useMemo(() => {
    const map = new Map<string, { label: string; items: Task[] }>()
    for (const t of data.done) {
      const k = t.completedAt ? dayKey(t.completedAt) : 'unknown'
      if (!map.has(k)) {
        map.set(k, { label: t.completedAt ? dateText(t.completedAt) : '更早', items: [] })
      }
      map.get(k)!.items.push(t)
    }
    return [...map.values()]
  }, [data.done])

  const paused = prefs.pausedUntil * 1000 > now
  const capturing = prefs.clipboardWatch && !paused
  const pauseLeft = Math.max(0, Math.ceil(prefs.pausedUntil - now / 1000))
  const pauseText =
    pauseLeft > 3600 ? `${Math.ceil(pauseLeft / 3600)} 小时后恢复` : `${Math.ceil(pauseLeft / 60)} 分钟后恢复`
  const seqMap = useMemo(() => {
    const m = new Map<string, number>()
    data.pending.forEach((t, i) => m.set(t.id, i + 1))
    data.done.forEach((t, i) => m.set(t.id, i + 1))
    return m
  }, [data.pending, data.done])

  const bgUrl = prefs.bgImage ? `${window.api.imgUrl(prefs.bgImage)}?v=${bgVer}` : ''
  const scheme = DARK_COLORS.has(prefs.bgColor) ? 'dark' : 'light'

  function renderItems(items: Task[], variant: 'pending' | 'done') {
    if (prefs.view === 'grid') {
      return (
        <div className="grid">
          {items.map((t) => (
            <GridCard
              key={t.id}
              task={t}
              variant={variant}
              index={seqMap.get(t.id) ?? 0}
              onToggle={toggle}
              onPreview={setPreview}
              onRemove={removeTask}
              onPin={togglePin}
              onColor={markColor}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              dragging={dragId === t.id}
              dragOver={overId === t.id}
            />
          ))}
        </div>
      )
    }
    return items.map((t) => (
      <TaskCard
        key={t.id}
        task={t}
        variant={variant}
        index={seqMap.get(t.id) ?? 0}
        onToggle={toggle}
        onPreview={setPreview}
        onTitle={changeTitle}
        onDue={changeDue}
        onRemove={removeTask}
        onPin={togglePin}
        onColor={markColor}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        dragging={dragId === t.id}
        dragOver={overId === t.id}
      />
    ))
  }

  return (
    <div
      className={`app ${prefs.locked ? 'locked' : ''} ${bgUrl ? 'has-bg' : ''}`}
      data-color={prefs.bgColor}
      data-scheme={scheme}
      data-fs={prefs.fontSize}
      data-tone={prefs.textTone}
      style={
        {
          '--alpha': prefs.panelAlpha,
          '--dim': prefs.bgDim
        } as React.CSSProperties
      }
    >
      <div
        className="bg"
        data-fit={prefs.bgFit}
        style={bgUrl ? { backgroundImage: `url("${bgUrl}")` } : undefined}
      />
      <div className="veil" />

      <div className="content">
        <TopBar
          prefs={prefs}
          onPrefs={updatePrefs}
          onPickBg={pickBg}
          onClearBg={clearBg}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {paused && prefs.clipboardWatch && (
          <div className="pause-bar" onClick={resume} title="点一下恢复自动收录">
            <span className="pause-dot" />
            已暂停收录 · {pauseText}
            <span className="pause-act">恢复</span>
          </div>
        )}

        <nav className="tabs">
          <button className={`tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
            待办
            <span className={`badge ${data.pendingCount > 0 ? 'hot' : ''}`}>{data.pendingCount}</span>
          </button>
          <button className={`tab ${tab === 'done' ? 'active' : ''}`} onClick={() => setTab('done')}>
            已完成
            <span className="badge">{data.done.length}</span>
          </button>
          <div className="tabs-right">
            <UpdateButton />
            <button
              className="tb-btn"
              title={prefs.view === 'list' ? '切换成宫格' : '切换成列表'}
              onClick={() => updatePrefs({ view: prefs.view === 'list' ? 'grid' : 'list' })}
            >
              {prefs.view === 'list' ? (
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <rect x="3" y="3.4" width="6" height="6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="11" y="3.4" width="6" height="6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="3" y="11" width="6" height="6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="11" y="11" width="6" height="6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <rect x="3" y="4" width="14" height="3.4" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="3" y="9.2" width="14" height="3.4" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="3" y="14.4" width="14" height="3.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
            </button>
            <button className="tb-btn" title="设置" onClick={() => setSettingsOpen(true)}>
              <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
                <path
                  d="M3 6.6h5.2M12.4 6.6H17M3 13.4h3.4M9.6 13.4H17"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <circle cx="10.4" cy="6.6" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="7.8" cy="13.4" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </div>
        </nav>

        <main className={`list ${prefs.view === 'grid' ? 'is-grid' : ''}`}>
          {!loaded && <div className="loading" />}

          {loaded && tab === 'pending' && (
            <>
              {today.length > 0 && (
                <section>
                  <div className="section-head">
                    <span>今日新增</span>
                    <span className="count">{today.length}</span>
                  </div>
                  {renderItems(today, 'pending')}
                </section>
              )}

              {backlog.length > 0 && (
                <section>
                  <div className="section-head">
                    <span>积压</span>
                    <span className="count">{backlog.length}</span>
                  </div>
                  {renderItems(backlog, 'pending')}
                </section>
              )}

              {data.pending.length === 0 && (
                <div className="empty">
                  <div className="empty-mark">
                    <svg viewBox="0 0 48 48" width="46" height="46" aria-hidden="true">
                      <rect x="4" y="8" width="40" height="32" rx="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
                      <path d="M16 24l5 5 11-12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="empty-title">还没有待办</div>
                  <div className="empty-sub">
                    用微信截图（Alt+A），点 √ 复制
                    <br />
                    图片会自动出现在这里
                  </div>
                </div>
              )}
            </>
          )}

          {loaded && tab === 'done' && (
            <>
              {doneGroups.map((g) => (
                <section key={g.label}>
                  <div className="section-head">
                    <span>{g.label}</span>
                    <span className="count">{g.items.length}</span>
                  </div>
                  {renderItems(g.items, 'done')}
                </section>
              ))}

              {data.done.length === 0 && (
                <div className="empty">
                  <div className="empty-title">还没完成过东西</div>
                  <div className="empty-sub">在待办里点左边的方框，就会跑到这里</div>
                </div>
              )}
            </>
          )}
        </main>

        <FestivalBar onOpen={() => setCalOpen(true)} />

        <footer className="footer">
          <button
            className={`rec ${capturing ? 'on' : 'off'}`}
            onClick={toggleCapture}
            role="switch"
            aria-checked={capturing}
            title={capturing ? '点一下停止自动收录' : '点一下开始自动收录'}
          >
            <span className="rec-track">
              <span className="rec-knob" />
            </span>
            <span className="rec-label">{capturing ? '收录中' : '已停止'}</span>
          </button>

          <button className="kbd-chip" onClick={toggleCapture} title="快捷键，按一下也能切换">
            {prettyAccel(prefs.hotkeyPause).join(' + ')}
          </button>

          <button className="btn paste-btn" onClick={pasteNow}>
            收录剪贴板
          </button>
        </footer>

      </div>

      {flash && <div className="flash">{flash}</div>}
      {preview && <Preview task={preview} onClose={() => setPreview(null)} />}
      {settingsOpen && (
        <SettingsModal
          prefs={prefs}
          onPatch={updatePrefs}
          onOpenHelp={() => setHelpOpen(true)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {calOpen && <CalendarModal onClose={() => setCalOpen(false)} />}
      {cropping && (
        <BgCropper
          file={cropping.file}
          width={cropping.width}
          height={cropping.height}
          onDone={(p) => {
            setCropping(null)
            applyPrefs(p)
            say('背景已更新')
          }}
          onCancel={() => setCropping(null)}
        />
      )}
    </div>
  )
}
