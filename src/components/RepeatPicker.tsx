import type { RepeatKind, RepeatRule } from '../../shared/types'
import { WEEK_LABEL, ruleReady, toggleDay, toggleWeekday } from '../lib/repeat'

interface Props {
  value: RepeatRule
  onChange: (rule: RepeatRule) => void
  /** 底部确认按钮；不传就只做即时修改 */
  onClose?: () => void
}

const KINDS: { k: RepeatKind; label: string }[] = [
  { k: 'none', label: '一次性' },
  { k: 'daily', label: '每天' },
  { k: 'weekly', label: '每周' },
  { k: 'monthly', label: '每月' }
]

/**
 * 重复规则选择器。
 * 每周/每月都支持多选 —— 一周做两次、一月做三次这类需求靠它表达。
 */
export function RepeatPicker({ value, onChange, onClose }: Props): React.ReactElement {
  const setKind = (k: RepeatKind): void => {
    if (k === value.kind) return
    // 切到每周默认勾今天，切到每月默认勾今天几号，省一步
    if (k === 'weekly' && !value.weekdays.length) {
      const iso = ((new Date().getDay() + 6) % 7) + 1
      onChange({ kind: k, weekdays: [iso], days: [] })
      return
    }
    if (k === 'monthly' && !value.days.length) {
      onChange({ kind: k, weekdays: [], days: [new Date().getDate()] })
      return
    }
    onChange({ ...value, kind: k })
  }

  return (
    <div className="rp">
      <div className="rp-kinds">
        {KINDS.map(({ k, label }) => (
          <button
            key={k}
            className={`rp-kind ${value.kind === k ? 'on' : ''}`}
            onClick={() => setKind(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {value.kind === 'weekly' && (
        <div className="rp-chips">
          {WEEK_LABEL.map((label, i) => {
            const d = i + 1
            return (
              <button
                key={d}
                className={`rp-chip ${value.weekdays.includes(d) ? 'on' : ''}`}
                onClick={() => onChange(toggleWeekday(value, d))}
                title={`周${label}`}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {value.kind === 'monthly' && (
        <div className="rp-days">
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <button
              key={d}
              className={`rp-day ${value.days.includes(d) ? 'on' : ''}`}
              onClick={() => onChange(toggleDay(value, d))}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {value.kind === 'weekly' && !value.weekdays.length && (
        <div className="rp-hint">至少选一个星期</div>
      )}
      {value.kind === 'monthly' && !value.days.length && (
        <div className="rp-hint">至少选一个日期</div>
      )}

      {onClose && (
        <div className="rp-foot">
          <button className="btn ghost sm" onClick={onClose} disabled={!ruleReady(value)}>
            好了
          </button>
        </div>
      )}
    </div>
  )
}
