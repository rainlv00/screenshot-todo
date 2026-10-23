import type { Task } from '../../shared/types'
import { doneText, heldLabel, heldLevel } from '../lib/format'

interface Props {
  task: Task
  variant: 'pending' | 'done'
  onToggle: (task: Task) => void
  onPreview: (task: Task) => void
  onRemove: (task: Task) => void
}

export function GridCard({ task, variant, onToggle, onPreview, onRemove }: Props) {
  const level = heldLevel(task.daysHeld)
  const meta = variant === 'pending' ? heldLabel(task.daysHeld) : task.completedAt ? doneText(task.completedAt) : '已完成'

  return (
    <div className={`gcard ${variant === 'done' ? 'is-done' : ''}`}>
      <img
        className="g-thumb"
        src={window.api.imgUrl(task.thumbPath)}
        alt=""
        draggable={false}
        loading="lazy"
        onClick={() => onPreview(task)}
      />

      <button
        className={`g-check ${variant === 'done' ? 'on' : ''}`}
        onClick={() => onToggle(task)}
        title={variant === 'done' ? '取消完成，拿回待办' : '标记为已完成'}
      >
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path d="M3.2 8.5l3.1 3.1 6.5-6.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button className="g-del" onClick={() => onRemove(task)} title="删除（可撤销）">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M3.2 4.4h9.6M6.4 4.4V3.1h3.2v1.3M4.4 4.4l.6 8.2h6l.6-8.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="g-info">
        <div className="g-title">{task.title || '未命名'}</div>
        <div className="g-meta">
          <span className={variant === 'pending' ? `held ${level}` : 'held calm'}>{meta}</span>
          {task.reopenCount > 0 && <span className="g-reopen">拿回{task.reopenCount}</span>}
        </div>
      </div>
    </div>
  )
}
