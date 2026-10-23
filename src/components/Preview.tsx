import { useEffect } from 'react'
import type { Task } from '../../shared/types'

export function Preview({ task, onClose }: { task: Task; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="preview" onClick={onClose}>
      <img src={window.api.imgUrl(task.imagePath)} onClick={(e) => e.stopPropagation()} alt="" />
      <div className="preview-hint">Esc 关闭</div>
    </div>
  )
}
