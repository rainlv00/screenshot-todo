import { useEffect, useState } from 'react'

const MOD_LABEL: Record<string, string> = {
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Super: 'Win'
}

function codeToKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (code === 'Space') return 'Space'
  if (code === 'Minus') return '-'
  if (code === 'Equal') return '='
  if (code === 'BracketLeft') return '['
  if (code === 'BracketRight') return ']'
  if (code === 'Backslash') return '\\'
  if (code === 'Semicolon') return ';'
  if (code === 'Quote') return "'"
  if (code === 'Comma') return ','
  if (code === 'Period') return '.'
  if (code === 'Slash') return '/'
  if (code === 'Backquote') return '`'
  return null
}

export function prettyAccel(acc: string): string[] {
  return acc.split('+').filter(Boolean).map((p) => MOD_LABEL[p] ?? p)
}

interface Props {
  value: string
  onChange: (acc: string) => void
}

export function HotkeyField({ value, onChange }: Props) {
  const [recording, setRecording] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!recording) return
    function onKey(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecording(false)
        setErr('')
        return
      }

      const mods: string[] = []
      if (e.ctrlKey) mods.push('Ctrl')
      if (e.altKey) mods.push('Alt')
      if (e.shiftKey) mods.push('Shift')
      if (e.metaKey) mods.push('Super')

      const main = codeToKey(e.code)
      // 只按住修饰键，等你按主键
      if (!main) return

      if (mods.length === 0) {
        setErr('至少要有一个 Ctrl / Alt / Shift / Win')
        return
      }
      if (mods.length + 1 > 3) {
        setErr('最多三个键')
        return
      }

      const acc = [...mods, main].join('+')
      void (async () => {
        const r = await window.api.hotkeyAvailable(acc)
        if (r.ok) {
          onChange(acc)
          setRecording(false)
          setErr('')
        } else {
          setErr(r.reason === 'invalid' ? '这个组合不可用' : `已被其他程序占用：${prettyAccel(acc).join(' + ')}`)
        }
      })()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])

  return (
    <div className="hk">
      <button
        className={`hk-box ${recording ? 'recording' : ''}`}
        onClick={() => {
          setErr('')
          setRecording((v) => !v)
        }}
      >
        {recording ? (
          <span className="hk-tip">按下组合键…</span>
        ) : (
          prettyAccel(value).map((k, i) => (
            <span key={i} className="kbd">
              {k}
            </span>
          ))
        )}
      </button>
      {err && <div className="hk-err">{err}</div>}
    </div>
  )
}
