import type { MarkColor, Task } from '../../shared/types'
import { doneText, heldLabel, heldLevel } from '../lib/format'

interface Props {
  task: Task
  variant: 'pending' | 'done'
  index: number
  onToggle: (task: Task) => void
  onPreview: (task: Task) => void
  onRemove: (task: Task) => void
  onPin: (task: Task) => void
  onColor: (task: Task, color: MarkColor) => void
  onPointerDown: (e: React.PointerEvent, id: string) => void
  dragging: boolean
  dragOver: boolean
}

/** 宫格里点一下色块循环换色：无 → 红 → 橙 → 绿 → 无 */
const CYCLE: MarkColor[] = ['none', 'red', 'orange', 'green']

export function GridCard({
  task,
  variant,
  index,
  onToggle,
  onPreview,
  onRemove,
  onPin,
  onColor,
  onPointerDown,
  dragging,
  dragOver
}: Props) {
  const level = heldLevel(task.daysHeld)
  const meta =
    variant === 'pending' ? heldLabel(task.daysHeld) : task.completedAt ? doneText(task.completedAt) : '已完成'
  const canDrag = variant === 'pending'

  return (
    <div
      className={`gcard color-${task.color} ${variant === 'done' ? 'is-done' : ''} ${
        task.pinned ? 'is-pinned' : ''
      } ${dragging ? 'is-dragging' : ''} ${dragOver ? 'is-over' : ''}`}
      data-task-id={task.id}
      onPointerDown={(e) => {
        if (canDrag) onPointerDown(e, task.id)
      }}
    >
      <img
        className="g-thumb"
        src={window.api.imgUrl(task.thumbPath)}
        alt=""
        draggable={false}
        loading="lazy"
        onClick={() => onPreview(task)}
      />

      <span className="g-idx">{index}</span>

      <button
        className={`g-check ${variant === 'done' ? 'on' : ''}`}
        onClick={() => onToggle(task)}
        title={variant === 'done' ? '取消完成，拿回待办' : '标记为已完成'}
      >
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path d="M3.2 8.5l3.1 3.1 6.5-6.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button
        className={`g-color ${task.color}`}
        title="颜色标记（点一下换一种）"
        onClick={() => {
          const i = CYCLE.indexOf(task.color)
          onColor(task, CYCLE[(i + 1) % CYCLE.length])
        }}
      />

      <button
        className={`g-pin ${task.pinned ? 'on' : ''}`}
        title={task.pinned ? '取消置顶' : '置顶'}
        onClick={() => onPin(task)}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M9.4 2.2l4.4 4.4-1.6 1.6-.6-.2-2.3 2.3.5 2.6-1 1-4.9-4.9 1-1 2.6.5L9.8 6.2l-.2-.6z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
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
