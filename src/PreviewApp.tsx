import { useCallback, useEffect, useRef, useState } from 'react'

const MIN = 0.1
const MAX = 10

export default function PreviewApp() {
  const [img, setImg] = useState('')
  const [title, setTitle] = useState('')
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    document.title = title || '查看图片'
  }, [title])

  useEffect(() => {
    return window.api.preview.onSet((p, t) => {
      setImg(p)
      setTitle(t)
      reset()
    })
  }, [reset])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close()
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(MAX, s * 1.25))
      if (e.key === '-') setScale((s) => Math.max(MIN, s / 1.25))
      if (e.key === '0') reset()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [reset])

  /** 滚轮以鼠标位置为中心缩放 */
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const box = boxRef.current
      if (!box) return
      const rect = box.getBoundingClientRect()
      const next = Math.min(MAX, Math.max(MIN, scale * (1 - e.deltaY * 0.0016)))
      if (next === scale) return
      const mx = e.clientX - rect.left - rect.width / 2 - offset.x
      const my = e.clientY - rect.top - rect.height / 2 - offset.y
      const ratio = next / scale
      setOffset({ x: offset.x - mx * (ratio - 1), y: offset.y - my * (ratio - 1) })
      setScale(next)
    },
    [scale, offset]
  )

  return (
    <div className="pv">
      <div
        ref={boxRef}
        className={`pv-box ${dragging ? 'is-dragging' : ''} ${scale > 1 ? 'can-pan' : ''}`}
        onWheel={onWheel}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
          setDragging(true)
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = dragRef.current
          if (!d) return
          setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) })
        }}
        onPointerUp={() => {
          dragRef.current = null
          setDragging(false)
        }}
        onDoubleClick={() => {
          if (scale > 1) reset()
          else setScale(2.5)
        }}
      >
        {img ? (
          <img
            src={window.api.imgUrl(img)}
            alt=""
            draggable={false}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        ) : (
          <div className="pv-empty">没有图片</div>
        )}
      </div>

      <div className="pv-bar">
        <button onClick={() => setScale((s) => Math.max(MIN, s / 1.4))} title="缩小（-）">
          −
        </button>
        <span className="pv-zoom" onClick={reset} title="点一下复位到 100%">
          {Math.round(scale * 100)}%
        </span>
        <button onClick={() => setScale((s) => Math.min(MAX, s * 1.4))} title="放大（+）">
          +
        </button>
        <span className="pv-hint">滚轮缩放 · 拖动平移 · 双击放大 · Esc 关闭</span>
      </div>
    </div>
  )
}
