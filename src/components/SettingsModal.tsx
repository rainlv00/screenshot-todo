import { useEffect, useRef, useState } from 'react'
import type { Prefs } from '../../shared/types'
import { HotkeyField } from './HotkeyField'

interface Props {
  prefs: Prefs
  onPatch: (p: Partial<Prefs>) => Promise<void>
  onOpenHelp: () => void
  onClose: () => void
}

export function SettingsModal({ prefs, onPatch, onOpenHelp, onClose }: Props) {
  const [p, setP] = useState<Prefs>(prefs)
  const [hk, setHk] = useState<{ capture: boolean; pause: boolean }>({ capture: true, pause: true })
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void (async () => {
      const a = await window.api.hotkeyAvailable(p.hotkeyCapture)
      const b = await window.api.hotkeyAvailable(p.hotkeyPause)
      if (alive) setHk({ capture: a.ok, pause: b.ok })
    })()
    return () => {
      alive = false
    }
  }, [p.hotkeyCapture, p.hotkeyPause])

  useEffect(() => {
    setP(prefs)
  }, [prefs])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function set(next: Partial<Prefs>, immediate = false) {
    setP((prev) => ({ ...prev, ...next }))
    if (timer.current) clearTimeout(timer.current)
    if (immediate) {
      void onPatch(next)
    } else {
      timer.current = window.setTimeout(() => void onPatch(next), 140)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>设置</span>
          <button className="tb-btn" onClick={onClose} title="关闭">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="group-title">快捷键</div>

          <div className="row">
            <div className="row-main">
              <div className="row-title">收录剪贴板里的图</div>
              <div className="row-sub">
                {hk.capture ? '不用打开窗口，截图后按一下就进待办' : <span className="hk-warn">未生效：已被其他程序占用，换一个</span>}
              </div>
            </div>
            <HotkeyField value={p.hotkeyCapture} onChange={(acc) => set({ hotkeyCapture: acc }, true)} />
          </div>

          <div className="row">
            <div className="row-main">
              <div className="row-title">暂停 / 恢复收录</div>
              <div className="row-sub">
                {hk.pause ? '做教程、发图给别人时按一下，再按恢复' : <span className="hk-warn">未生效：已被其他程序占用，换一个</span>}
              </div>
            </div>
            <HotkeyField value={p.hotkeyPause} onChange={(acc) => set({ hotkeyPause: acc }, true)} />
          </div>

          <div className="group-title">窗口</div>

          <div className="row">
            <div className="row-main">
              <div className="row-title">始终置顶</div>
              <div className="row-sub">关闭时是普通窗口，别的软件会盖住它，不挡你干活</div>
            </div>
            <Switch on={p.alwaysOnTop} onChange={(v) => set({ alwaysOnTop: v }, true)} />
          </div>

          <div className="row">
            <div className="row-main">
              <div className="row-title">锁定面板</div>
              <div className="row-sub">禁止拖动、隐藏最小化/关闭按钮，从托盘右键解锁</div>
            </div>
            <Switch on={p.locked} onChange={(v) => set({ locked: v }, true)} />
          </div>

          <div className="group-title">收录</div>

          <div className="row">
            <div className="row-main">
              <div className="row-title">自动收录剪贴板图片</div>
              <div className="row-sub">微信截图点 √ 后自动出现；关掉后只认快捷键</div>
            </div>
            <Switch on={p.clipboardWatch} onChange={(v) => set({ clipboardWatch: v }, true)} />
          </div>

          <div className="row">
            <div className="row-main">
              <div className="row-title">暂停时长</div>
              <div className="row-sub">
                托盘「暂停收录」按这个时长自动恢复；选「不限时」则一直停到手动恢复
              </div>
            </div>
          </div>
          <div className="row" style={{ paddingTop: 0 }}>
            <div className="seg" style={{ width: '100%', marginTop: 0 }}>
              {[
                [5, '5 分钟'],
                [15, '15 分钟'],
                [30, '30 分钟'],
                [60, '1 小时'],
                [0, '不限时']
              ].map(([v, label]) => (
                <button
                  key={v}
                  className={p.pauseMinutes === v ? 'on' : ''}
                  onClick={() => set({ pauseMinutes: v as number }, true)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="group-title">提醒</div>

          <div className="row">
            <div className="row-main">
              <div className="row-title">每日提醒</div>
              <div className="row-sub">到点提醒你过一遍，没有待办时不打扰</div>
            </div>
            <input
              className="time-input"
              type="time"
              value={p.dailyRemindAt}
              onChange={(e) => set({ dailyRemindAt: e.target.value || '08:30' })}
            />
            <Switch on={p.dailyRemindEnabled} onChange={(v) => set({ dailyRemindEnabled: v }, true)} />
          </div>

          <div className="group-title">其他</div>

          <div className="row">
            <div className="row-main">
              <div className="row-title">开机自启</div>
              <div className="row-sub">登录 Windows 后自动在托盘运行</div>
            </div>
            <Switch on={p.autostart} onChange={(v) => set({ autostart: v }, true)} />
          </div>

          <div className="row">
            <div className="row-main">
              <div className="row-title">数据目录</div>
              <div className="row-sub">图片和数据库都在这里，整个目录拷走即可备份</div>
            </div>
            <button className="btn" onClick={() => window.api.openDataDir()}>
              打开
            </button>
          </div>

          <div className="group-title">帮助</div>

          <div className="row">
            <div className="row-main">
              <div className="row-title">使用说明</div>
              <div className="row-sub">怎么收录、怎么设快捷键、数据在哪、常见问题</div>
            </div>
            <button className="btn" onClick={onOpenHelp}>
              查看
            </button>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={() => window.api.quit()}>
            退出程序
          </button>
          <div className="version">v1.0.0</div>
        </div>
      </div>
    </div>
  )
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="knob" />
    </button>
  )
}
