import { useEffect, useRef, useState } from 'react'
import type { MarkColor, RepeatRule, Task } from '../../shared/types'
import { doneText, dueText, heldLabel, heldLevel, localInputToTs, tsToLocalInput } from '../lib/format'
import { repeatLabel, repeatOverdueDays } from '../lib/repeat'
import { RepeatPicker } from './RepeatPicker'

interface Props {
  task: Task
  variant: 'pending' | 'done'
  index: number
  onToggle: (task: Task) => void
  onPreview: (task: Task) => void
  onTitle: (task: Task, title: string) => void
  onDue: (task: Task, dueAt: number | null) => void
  onRemove: (task: Task) => void
  onPin: (task: Task) => void
  onColor: (task: Task, color: MarkColor) => void
  onRepeat: (task: Task, rule: RepeatRule) => void
  onAttachImage: (task: Task) => void
  onPointerDown: (e: React.PointerEvent, id: string) => void
  dragging: boolean
  dragOver: boolean
}

export function TaskCard({
  task,
  variant,
  index,
  onToggle,
  onPreview,
  onTitle,
  onDue,
  onRemove,
  onPin,
  onColor,
  onRepeat,
  onAttachImage,
  onPointerDown,
  dragging,
  dragOver
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const [dueOpen, setDueOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [repeatOpen, setRepeatOpen] = useState(false)
  const [popPos, setPopPos] = useState<{ x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const level = heldLevel(task.daysHeld)
  const overdueDays = variant === 'pending' ? repeatOverdueDays(task) : 0
  const due = task.dueAt ? dueText(task.dueAt) : null
  const canDrag = variant === 'pending' && !editing

  function commitTitle() {
    setEditing(false)
    const v = draft.trim()
    if (v !== task.title) onTitle(task, v)
  }

  return (
    <div
      className={`card color-${task.color} ${variant === 'done' ? 'is-done' : ''} ${
        task.pinned ? 'is-pinned' : ''
      } ${dragging ? 'is-dragging' : ''} ${dragOver ? 'is-over' : ''}`}
      data-task-id={task.id}
      onPointerDown={(e) => {
        if (canDrag) onPointerDown(e, task.id)
      }}
    >
      <button
        className={`pin-corner ${task.pinned ? 'on' : ''}`}
        title={task.pinned ? '取消置顶' : '置顶'}
        onClick={() => onPin(task)}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M9.4 2.2l4.4 4.4-1.6 1.6-.6-.2-2.3 2.3.5 2.6-1 1-4.9-4.9 1-1 2.6.5L9.8 6.2l-.2-.6z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <span className="idx">{index}</span>

      <button
        className={`check ${variant === 'done' ? 'on' : ''}`}
        onClick={() => onToggle(task)}
        title={variant === 'done' ? '取消完成，拿回待办' : '标记为已完成'}
        aria-label={variant === 'done' ? '取消完成' : '标记为已完成'}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M3.2 8.5l3.1 3.1 6.5-6.8" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {task.imagePath ? (
        <button
          className="thumb"
          onClick={() => onPreview(task)}
          title={`${task.title || '未命名'}\n点击查看大图`}
        >
          <img src={window.api.imgUrl(task.thumbPath)} alt="" draggable={false} loading="lazy" />
        </button>
      ) : (
        // 手动新建的待办没有图，用占位图块保持和带图任务同样的版式；点它可以补一张图
        <button
          className={`thumb ph color-${task.color}`}
          title={`${task.title || '未命名'}\n点击添加图片`}
          onClick={() => onAttachImage(task)}
        >
          <span>{(task.title || '待办').trim().slice(0, 1)}</span>
          <i className="ph-plus" aria-hidden="true">
            +
          </i>
        </button>
      )}

      <div className="body">
        {editing ? (
          <input
            ref={inputRef}
            className="title-input"
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') {
                setDraft(task.title)
                setEditing(false)
              }
            }}
          />
        ) : (
          <div
            className={`title ${task.title ? '' : 'untitled'}`}
            onDoubleClick={() => {
              setDraft(task.title)
              setEditing(true)
            }}
            title={`${task.title || '未命名'}\n双击编辑标题`}
          >
            {task.title || '未命名'}
          </div>
        )}

        <div className="meta">
          {variant === 'pending' ? (
            <>
              <span className={`held ${level}`}>{heldLabel(task.daysHeld)}</span>
              {due && (
                <>
                  <span className="dot">·</span>
                  <span className={due.overdue ? 'overdue' : 'due'}>{due.text}</span>
                </>
              )}
            </>
          ) : (
            <span className="held calm">{task.completedAt ? doneText(task.completedAt) : '已完成'}</span>
          )}
          {task.repeat.kind !== 'none' && (
            <span className="rp-tag" title="重复规则，点右侧图标可修改">
              {repeatLabel(task.repeat)}
            </span>
          )}
          {overdueDays > 0 && (
            <span className="overdue" title={`计划日期已过 ${overdueDays} 天，不会自动跳过`}>
              逾期 {overdueDays} 天
            </span>
          )}
          {task.reopenCount > 0 && (
            <span className="reopen" title={`被取消完成 ${task.reopenCount} 次`}>
              拿回过 {task.reopenCount} 次
            </span>
          )}
          {task.repeat.kind !== 'none' && task.doneCount > 0 && (
            <span className="done-count" title={`这条已经完成过 ${task.doneCount} 次`}>
              已完成 {task.doneCount} 次
            </span>
          )}
        </div>

        {dueOpen && (
          <div className="due-edit">
            <input
              type="datetime-local"
              defaultValue={tsToLocalInput(task.dueAt)}
              onChange={(e) => {
                onDue(task, localInputToTs(e.target.value))
                setDueOpen(false)
              }}
            />
            <button className="mini" onClick={() => { onDue(task, null); setDueOpen(false) }}>
              清除
            </button>
          </div>
        )}
      </div>

      <div className="actions">
        <button
          className={`icon-btn color-btn ${task.color !== 'none' ? 'on' : ''}`}
          title="颜色标记"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setPopPos({
              x: Math.min(r.left - 40, window.innerWidth - 160),
              y: Math.min(r.bottom + 6, window.innerHeight - 70)
            })
            setColorOpen((v) => !v)
          }}
        >
          <span className={`color-dot ${task.color}`} />
        </button>
        <button
          className="icon-btn"
          title="设置截止时间（选填）"
          onClick={() => setDueOpen((v) => !v)}
        >
          <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
            <rect x="2.2" y="3.4" width="11.6" height="10.4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
            <path d="M2.2 6.6h11.6M5.7 1.9v2.4M10.3 1.9v2.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className={`icon-btn ${task.repeat.kind !== 'none' ? 'on' : ''}`}
          title={task.repeat.kind === 'none' ? '设置重复' : `重复：${repeatLabel(task.repeat)}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setPopPos({
              x: Math.min(r.left - 150, window.innerWidth - 260),
              y: Math.min(r.bottom + 6, window.innerHeight - 300)
            })
            setRepeatOpen((v) => !v)
          }}
        >
          <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
            <path
              d="M3 6.2a5 5 0 0 1 8.6-2M13 9.8a5 5 0 0 1-8.6 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path d="M11.4 1.8v2.6H8.8M4.6 14.2v-2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="icon-btn danger" title="删除（6 秒内可撤销）" onClick={() => onRemove(task)}>
          <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
            <path
              d="M3.2 4.4h9.6M6.4 4.4V3.1h3.2v1.3M4.4 4.4l.6 8.2h6l.6-8.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>


      {repeatOpen && popPos && (
        <>
          <div className="color-mask" onClick={() => setRepeatOpen(false)} />
          <div className="rp-float" style={{ left: popPos.x, top: popPos.y }}>
            <RepeatPicker
              value={task.repeat}
              onChange={(rule) => onRepeat(task, rule)}
              onClose={() => setRepeatOpen(false)}
            />
          </div>
        </>
      )}

      {colorOpen && popPos && (
        <>
          <div className="color-mask" onClick={() => setColorOpen(false)} />
          <div className="color-float" style={{ left: popPos.x, top: popPos.y }}>
            {(['red', 'orange', 'green'] as MarkColor[]).map((c) => (
              <button
                key={c}
                className={`ci-dot ${c} ${task.color === c ? 'on' : ''}`}
                title={c === 'red' ? '红色' : c === 'orange' ? '橙色' : '绿色'}
                onClick={() => {
                  onColor(task, c)
                  setColorOpen(false)
                }}
              />
            ))}
            {task.color !== 'none' && (
              <button
                className="ci-clear"
                onClick={() => {
                  onColor(task, 'none')
                  setColorOpen(false)
                }}
              >
                清除
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
