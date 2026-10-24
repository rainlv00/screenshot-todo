import { useState } from 'react'
import type { PanelColor, Prefs } from '../../shared/types'

const COLORS: { key: PanelColor; label: string; css: string }[] = [
  { key: 'white', label: '白', css: '#ffffff' },
  { key: 'gray', label: '灰', css: '#6f7684' },
  { key: 'black', label: '黑', css: '#14161c' },
  { key: 'blue', label: '蓝', css: '#2563eb' },
  { key: 'green', label: '绿', css: '#12945f' },
  { key: 'yellow', label: '黄', css: '#f2c33c' }
]

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function todayLabel(): string {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`
}

interface Props {
  prefs: Prefs
  onPrefs: (p: Partial<Prefs>) => void
  onPickBg: () => void
  onClearBg: () => void
  onOpenSettings: () => void
}

export function TopBar({ prefs, onPrefs, onPickBg, onClearBg, onOpenSettings }: Props) {
  const [open, setOpen] = useState<'alpha' | 'bg' | null>(null)

  return (
    <header className="titlebar">
      <div className="tb-left">
        <img className="mark" src="./logo.png" width="20" height="20" alt="" draggable={false} />
        <span className="today">{todayLabel()}</span>
        {prefs.locked && <span className="lock-chip">已锁定</span>}
      </div>

      <div className="tb-right">
        {/* 透明度 + 底色 */}
        <div className="pop-wrap">
          <button
            className={`tb-btn ${open === 'alpha' ? 'on' : ''}`}
            title="透明度与底色"
            onClick={() => setOpen(open === 'alpha' ? null : 'alpha')}
          >
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 2.8a7.2 7.2 0 010 14.4z" fill="currentColor" opacity="0.85" />
            </svg>
          </button>
          {open === 'alpha' && (
            <>
              <div className="pop-mask" onClick={() => setOpen(null)} />
              <div className="popover">
                <div className="pop-row">
                  <span className="pop-label">不透明度</span>
                  <span className="pop-val">{Math.round(prefs.panelAlpha * 100)}%</span>
                </div>
                <input
                  className="slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(prefs.panelAlpha * 100)}
                  onChange={(e) => onPrefs({ panelAlpha: Number(e.target.value) / 100 })}
                />
                <div className="pop-sep" />
                <div className="pop-row">
                  <span className="pop-label">底色</span>
                </div>
                <div className="swatches">
                  {COLORS.map((c) => (
                    <button
                      key={c.key}
                      className={`swatch ${prefs.bgColor === c.key ? 'on' : ''}`}
                      style={{ background: c.css }}
                      title={c.label}
                      onClick={() => onPrefs({ bgColor: c.key })}
                    />
                  ))}
                </div>
                <div className="pop-sep" />
                <div className="pop-row">
                  <span className="pop-label">字号</span>
                </div>
                <div className="seg">
                  {([
                    ['small', '小'],
                    ['normal', '标准'],
                    ['large', '大'],
                    ['xl', '特大']
                  ] as const).map(([k, label]) => (
                    <button
                      key={k}
                      className={prefs.fontSize === k ? 'on' : ''}
                      onClick={() => onPrefs({ fontSize: k })}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="pop-row" style={{ marginTop: 10 }}>
                  <span className="pop-label">文字颜色</span>
                </div>
                <div className="tone-row">
                  {([
                    ['auto', '自动'],
                    ['black', '黑'],
                    ['white', '白'],
                    ['blue', '蓝'],
                    ['green', '绿'],
                    ['yellow', '黄']
                  ] as const).map(([k, label]) => (
                    <button
                      key={k}
                      className={`tone-dot ${k} ${prefs.textTone === k ? 'on' : ''}`}
                      title={label}
                      onClick={() => onPrefs({ textTone: k as typeof prefs.textTone })}
                    >
                      {k === 'auto' ? 'A' : ''}
                    </button>
                  ))}
                </div>
                <div className="pop-hint">调低不透明度能看到桌面，文字不会跟着变淡</div>
              </div>
            </>
          )}
        </div>

        {/* 背景图 */}
        <div className="pop-wrap">
          <button
            className={`tb-btn ${open === 'bg' ? 'on' : ''}`}
            title="背景图"
            onClick={() => setOpen(open === 'bg' ? null : 'bg')}
          >
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <rect x="2.4" y="3.6" width="15.2" height="12.8" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="7.2" cy="8.2" r="1.5" fill="currentColor" />
              <path d="M3.4 14.6l4.3-4.6 3 3 2.4-2.5 3.3 4.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open === 'bg' && (
            <>
              <div className="pop-mask" onClick={() => setOpen(null)} />
              <div className="popover">
                <button
                  className="pop-btn"
                  onClick={() => {
                    setOpen(null)
                    onPickBg()
                  }}
                >
                  {prefs.bgImage ? '更换图片并裁剪' : '选择图片并裁剪'}
                </button>
                {prefs.bgImage && (
                  <>
                    <button
                      className="pop-btn subtle"
                      onClick={() => {
                        setOpen(null)
                        onClearBg()
                      }}
                    >
                      清除背景图
                    </button>
                    <div className="pop-sep" />
                    <div className="pop-row">
                      <span className="pop-label">背景遮罩</span>
                      <span className="pop-val">{Math.round(prefs.bgDim * 100)}%</span>
                    </div>
                    <input
                      className="slider"
                      type="range"
                      min={0}
                      max={90}
                      step={1}
                      value={Math.round(prefs.bgDim * 100)}
                      onChange={(e) => onPrefs({ bgDim: Number(e.target.value) / 100 })}
                    />
                    <div className="pop-sep" />
                    <div className="pop-row">
                      <span className="pop-label">图片铺法</span>
                    </div>
                    <div className="seg">
                      <button
                        className={prefs.bgFit === 'contain' ? 'on' : ''}
                        onClick={() => onPrefs({ bgFit: 'contain' })}
                      >
                        完整（留底色）
                      </button>
                      <button
                        className={prefs.bgFit === 'cover' ? 'on' : ''}
                        onClick={() => onPrefs({ bgFit: 'cover' })}
                      >
                        铺满（裁边）
                      </button>
                    </div>
                    <div className="pop-hint">图片太花就调高遮罩，文字会更清楚</div>
                  </>
                )}
                {!prefs.bgImage && <div className="pop-hint">图片按比例贴合面板，留白处用底色填充</div>}
              </div>
            </>
          )}
        </div>

        {/* 锁定 */}
        <button
          className={`tb-btn ${prefs.locked ? 'on' : ''}`}
          title={prefs.locked ? '解锁（也可在托盘右键解锁）' : '锁定面板，防误拖'}
          onClick={() => onPrefs({ locked: !prefs.locked })}
        >
          {prefs.locked ? (
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <rect x="4.2" y="9" width="11.6" height="8.4" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6.8 9V6.6a3.2 3.2 0 016.4 0V9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <rect x="4.2" y="9" width="11.6" height="8.4" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6.8 9V6.6a3.2 3.2 0 015.9-1.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </button>

        {!prefs.locked && (
          <>
            <button className="tb-btn" title="最小化" onClick={() => window.api.minimizeWindow()}>
              <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
                <path d="M5 10h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <button className="tb-btn close" title="收进托盘" onClick={() => window.api.hideWindow()}>
              <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
                <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </>
        )}
      </div>
    </header>
  )
}
