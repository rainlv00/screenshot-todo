import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task } from '../../shared/types'

const MIN = 0.2
const MAX = 8

export function Preview({ task, onClose }: { task: Task; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(MAX, s * 1.25))
      if (e.key === '-') setScale((s) => Math.max(MIN, s / 1.25))
      if (e.key === '0') reset()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, reset])

  /** 滚轮以鼠标位置为中心缩放，和微信预览一致 */
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
    <div className="preview" onClick={onClose} onWheel={onWheel}>
      <div
        ref={boxRef}
        className={`preview-box ${dragging ? 'is-dragging' : ''} ${scale > 1 ? 'can-pan' : ''}`}
        onClick={(e) => e.stopPropagation()}
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
        <img
          src={window.api.imgUrl(task.imagePath)}
          alt=""
          draggable={false}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        />
      </div>

      <div className="preview-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setScale((s) => Math.max(MIN, s / 1.25))} title="缩小（-）">
          −
        </button>
        <span className="preview-zoom" onClick={reset} title="点一下复位到 100%">
          {Math.round(scale * 100)}%
        </span>
        <button onClick={() => setScale((s) => Math.min(MAX, s * 1.25))} title="放大（+）">
          +
        </button>
      </div>

      <div className="preview-hint">滚轮缩放 · 拖动平移 · 双击放大 · Esc 关闭</div>
    </div>
  )
}
