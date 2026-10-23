import { useEffect, useState } from 'react'
import type { ToastPayload } from '../shared/types'

export default function ToastApp() {
  const [p, setP] = useState<ToastPayload | null>(null)

  useEffect(() => {
    const off = window.api.onToast(setP)
    return off
  }, [])

  if (!p) return null

  const isDelete = p.kind === 'deleted'

  return (
    <div className={`toast ${isDelete ? 'is-delete' : ''}`}>
      <img className="toast-thumb" src={window.api.imgUrl(p.thumbPath)} alt="" />
      <div className="toast-body">
        <div className="toast-title">{isDelete ? '已删除' : '已收入待办'}</div>
        <div className="toast-sub">{p.title || '未命名'}</div>
      </div>
      <button
        className="toast-undo"
        onClick={() => {
          window.api.toastUndo(p.taskId, p.kind)
          setP(null)
        }}
      >
        撤销
      </button>
    </div>
  )
}
