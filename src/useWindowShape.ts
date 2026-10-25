import { useEffect } from 'react'

export interface ShapeRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 把窗口裁成「只有这些元素存在」的形状。
 *
 * 形状外的区域系统根本不认为有窗口，鼠标直接落到桌面，没有切换延迟；
 * 形状内是正常窗口，拖拽文件的 drop 能稳定收到。
 *
 * @param send       发给主进程的方法
 * @param deps       依赖变化时重算
 * @param fullScreen 为 true 时整屏可交互（拖动面板、弹层打开时用）
 * @param selector   参与形状的元素选择器
 */
export function useWindowShape(
  send: (rects: ShapeRect[]) => void,
  deps: unknown[],
  fullScreen: boolean,
  selector = '[data-shape]'
): void {
  useEffect(() => {
    const calc = (): void => {
      if (fullScreen) {
        send([{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }])
        return
      }
      const rects: ShapeRect[] = []
      document.querySelectorAll(selector).forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) return
        rects.push({
          x: Math.floor(r.left),
          y: Math.floor(r.top),
          width: Math.ceil(r.width),
          height: Math.ceil(r.height)
        })
      })
      send(rects)
    }

    calc()
    // 布局可能还没稳定，补一帧
    const t1 = window.setTimeout(calc, 60)
    const t2 = window.setTimeout(calc, 260)
    window.addEventListener('resize', calc)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', calc)
    }
    // deps 由调用方保证
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
