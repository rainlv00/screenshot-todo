export type TaskStatus = 'pending' | 'done'

export interface Task {
  id: string
  title: string
  /** 相对 data 目录的路径，如 images/xxx.jpg */
  imagePath: string
  thumbPath: string
  /** 截止时间 epoch 秒，null 表示未设置 */
  dueAt: number | null
  status: TaskStatus
  source: string
  /** 被"拿回"（取消完成）的次数 */
  reopenCount: number
  /** 放入待办的时间 epoch 秒 */
  createdAt: number
  completedAt: number | null
  /** 置顶：优先显示 */
  pinned: boolean
  /** 颜色标记 */
  color: MarkColor
  /** 手动排序值，越小越靠前 */
  sortOrder: number
  /** 放置天数（按自然日计算） */
  daysHeld: number
}

export type PanelColor = 'white' | 'gray' | 'black' | 'blue' | 'yellow' | 'green'
export type ViewMode = 'list' | 'grid'

/** 待办颜色标记 */
export type MarkColor = 'none' | 'red' | 'orange' | 'green'

export interface Prefs {
  dailyRemindAt: string
  dailyRemindEnabled: boolean
  /** 提醒频率：每天 / 每周指定几天 */
  remindMode: 'daily' | 'weekly'
  /** 每周提醒的星期，1=周一 … 7=周日 */
  remindWeekdays: number[]
  clipboardWatch: boolean
  autostart: boolean
  /** 窗口始终置顶 */
  alwaysOnTop: boolean
  /** 锁定面板：禁止拖动、隐藏窗口按钮 */
  locked: boolean
  /** 面板不透明度 0.1 - 1 */
  panelAlpha: number
  /** 底色 */
  bgColor: PanelColor
  /** 背景图上的白色遮罩浓度 0 - 0.9，越大字越清楚 */
  bgDim: number
  /** 背景图文件名，空串表示无 */
  bgImage: string
  /** 背景图铺法：contain 完整留底色 / cover 铺满裁边 */
  bgFit: 'contain' | 'cover'
  /** 暂停收录截止时间 epoch 秒，0 表示未暂停 */
  pausedUntil: number
  /** 托盘"暂停收录"的默认时长（分钟），0 = 不自动恢复 */
  pauseMinutes: number
  /** 全局快捷键：从剪贴板收录 */
  hotkeyCapture: string
  /** 全局快捷键：暂停/恢复收录 */
  hotkeyPause: string
  /** 打开/关闭桌面分区的快捷键 */
  hotkeyDesk: string
  /** 列表 / 宫格 */
  view: ViewMode
  /** 字号档位 */
  fontSize: 'small' | 'normal' | 'large' | 'xl'
  /** 文字色调，auto = 跟随底色 */
  textTone: 'auto' | 'black' | 'white' | 'blue' | 'green' | 'yellow'
}

export interface UpdateInfo {
  version: string
  current: string
  notes: string
  url: string
  size: number
  publishedAt: string
}

export interface BgPickResult {
  file: string
  width: number
  height: number
}

export interface ToastPayload {
  kind: 'added' | 'deleted'
  taskId: string
  thumbPath: string
  title: string
}

export interface ListResult {
  pending: Task[]
  done: Task[]
  pendingCount: number
}
