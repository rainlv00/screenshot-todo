import { useEffect, useState } from 'react'
import type { UpdateInfo } from '../../shared/types'

type Status = 'idle' | 'downloading' | 'ready' | 'error'

export function UpdateButton() {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [percent, setPercent] = useState(0)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)

  async function doCheck(silent = true) {
    if (checking) return
    setChecking(true)
    try {
      const r = await window.api.checkUpdate()
      setInfo(r)
      if (!silent) setOpen(true)
    } finally {
      setChecking(false)
      setChecked(true)
    }
  }

  // 启动 15 秒后静默查一次
  useEffect(() => {
    const t = setTimeout(() => void doCheck(true), 15000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const off = window.api.onUpdateProgress((s) => {
      setStatus(s.status as Status)
      setPercent(s.percent)
      if (s.error) setErr(s.error)
    })
    return () => off()
  }, [])

  async function startDownload() {
    if (!info) return
    setErr('')
    setStatus('downloading')
    const s = await window.api.downloadUpdate(info)
    if (s.status === 'ready') {
      await window.api.installUpdate()
    } else {
      setStatus('error')
      setErr(s.error || '下载失败')
    }
  }

  const hasUpdate = !!info
  const busy = status === 'downloading'

  return (
    <div className="pop-wrap">
      <button
        className={`tb-btn ${hasUpdate ? 'has-update' : ''} ${open ? 'on' : ''}`}
        title={hasUpdate ? `有新版本 ${info!.version}` : '检查更新'}
        onClick={() => {
          setOpen((v) => !v)
          if (!checked) void doCheck(false)
        }}
      >
        <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
          <path d="M10 3v8.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M6.4 8.4L10 12l3.6-3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M4 15.4h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {hasUpdate && <span className="update-dot" />}
      </button>

      {open && (
        <>
          <div className="pop-mask" onClick={() => setOpen(false)} />
          <div className="popover update-pop">
            {checking && <div className="pop-hint">正在检查…</div>}

            {!checking && !hasUpdate && (
              <>
                <div className="update-title">已是最新版本</div>
                <div className="pop-hint">暂时没有新版本，过段时间会自动再查</div>
                <button className="pop-btn subtle" style={{ marginTop: 10 }} onClick={() => void doCheck(false)}>
                  重新检查
                </button>
              </>
            )}

            {!checking && hasUpdate && (
              <>
                <div className="update-title">发现新版本 {info!.version}</div>
                <div className="pop-hint">当前 v{info!.current}</div>

                {info!.notes && <pre className="update-notes">{info!.notes.slice(0, 400)}</pre>}

                {busy && (
                  <>
                    <div className="update-bar">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <div className="pop-hint">正在下载 {percent}%</div>
                  </>
                )}

                {status === 'error' && <div className="hk-err" style={{ textAlign: 'left' }}>{err}</div>}

                {!busy && (
                  <div className="update-actions">
                    <button className="pop-btn" onClick={startDownload}>
                      立即更新
                    </button>
                    <button className="pop-btn subtle" onClick={() => void window.api.openReleasePage()}>
                      打开发布页
                    </button>
                  </div>
                )}
                <div className="pop-hint">更新会关闭程序并自动重装，数据不会丢</div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
