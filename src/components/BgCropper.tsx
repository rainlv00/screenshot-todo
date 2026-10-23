import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Prefs } from '../../shared/types'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  file: string
  width: number
  height: number
  onDone: (p: Prefs) => void
  onCancel: () => void
}

type Mode = 'move' | 'nw' | 'ne' | 'sw' | 'se'

const MIN = 36

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function BgCropper({ file, width, height, onDone, onCancel }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [disp, setDisp] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 })
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 })
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ mode: Mode; sx: number; sy: number; start: Rect } | null>(null)

  // 量容器
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 图片按 contain 摆放，初始选框 = 整张图
  useEffect(() => {
    if (!box.w || !box.h || !width || !height) return
    const scale = Math.min(box.w / width, box.h / height)
    const dw = width * scale
    const dh = height * scale
    const d = { x: (box.w - dw) / 2, y: (box.h - dh) / 2, w: dw, h: dh }
    setDisp(d)
    setRect(d)
  }, [box.w, box.h, width, height])

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const s = drag.current
      if (!s) return
      e.preventDefault()
      const dx = e.clientX - s.sx
      const dy = e.clientY - s.sy
      const st = s.start
      const b = disp

      if (s.mode === 'move') {
        setRect({
          ...st,
          x: clamp(st.x + dx, b.x, b.x + b.w - st.w),
          y: clamp(st.y + dy, b.y, b.y + b.h - st.h)
        })
        return
      }

      let { x, y, w, h } = st
      if (s.mode === 'nw') {
        x = clamp(st.x + dx, b.x, st.x + st.w - MIN)
        y = clamp(st.y + dy, b.y, st.y + st.h - MIN)
        w = st.x + st.w - x
        h = st.y + st.h - y
      } else if (s.mode === 'ne') {
        y = clamp(st.y + dy, b.y, st.y + st.h - MIN)
        w = clamp(st.w + dx, MIN, b.x + b.w - st.x)
        h = st.y + st.h - y
      } else if (s.mode === 'sw') {
        x = clamp(st.x + dx, b.x, st.x + st.w - MIN)
        w = st.x + st.w - x
        h = clamp(st.h + dy, MIN, b.y + b.h - st.y)
      } else {
        w = clamp(st.w + dx, MIN, b.x + b.w - st.x)
        h = clamp(st.h + dy, MIN, b.y + b.h - st.y)
      }
      setRect({ x, y, w, h })
    }
    function onUp() {
      drag.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [disp])

  function start(mode: Mode, e: React.PointerEvent) {
    e.stopPropagation()
    e.preventDefault()
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: rect }
  }

  async function confirm() {
    if (!disp.w || !disp.h) return
    setBusy(true)
    const sx = width / disp.w
    const sy = height / disp.h
    const next = await window.api.cropBackground({
      x: (rect.x - disp.x) * sx,
      y: (rect.y - disp.y) * sy,
      width: rect.w * sx,
      height: rect.h * sy
    })
    setBusy(false)
    onDone(next)
  }

  async function cancel() {
    await window.api.cancelBackgroundPick()
    onCancel()
  }

  return (
    <div className="modal-mask" onClick={cancel}>
      <div className="modal crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>裁剪背景</span>
          <button className="tb-btn" onClick={cancel} title="取消">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="crop-box" ref={boxRef}>
          <img
            className="crop-img"
            src={`${window.api.imgUrl(file)}?v=${Date.now()}`}
            style={{ left: disp.x, top: disp.y, width: disp.w, height: disp.h }}
            draggable={false}
            alt=""
          />
          <div className="crop-mask" />
          {disp.w > 0 && (
            <div
              className="crop-rect"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              onPointerDown={(e) => start('move', e)}
            >
              <span className="crop-handle nw" onPointerDown={(e) => start('nw', e)} />
              <span className="crop-handle ne" onPointerDown={(e) => start('ne', e)} />
              <span className="crop-handle sw" onPointerDown={(e) => start('sw', e)} />
              <span className="crop-handle se" onPointerDown={(e) => start('se', e)} />
            </div>
          )}
        </div>

        <div className="crop-foot">
          <div className="crop-hint">
            拖动选区内移动，拖四角改大小
            <br />
            缩放面板时图片按比例贴合，留白用底色填充
          </div>
          <div className="crop-actions">
            <button className="btn" onClick={cancel}>
              取消
            </button>
            <button className="btn primary" onClick={confirm} disabled={busy}>
              {busy ? '处理中…' : '确定'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
