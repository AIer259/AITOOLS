export interface AnchorRect {
  left: number
  right: number
  top: number
  bottom: number
}

export interface PanelPosition {
  left: number
  top: number
}

interface PanelPlacement {
  width: number
  height: number
  offset?: number
  margin?: number
  align?: 'start' | 'end'
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 计算固定定位弹层的位置：默认右对齐锚点，空间不足时翻到上方 */
export function placePanel(
  anchor: AnchorRect,
  { width, height, offset = 6, margin = 8, align = 'end' }: PanelPlacement,
): PanelPosition {
  const panelWidth = Math.min(width, window.innerWidth - margin * 2)
  const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin)
  const preferredLeft = align === 'start' ? anchor.left : anchor.right - panelWidth

  const spaceBelow = window.innerHeight - anchor.bottom - margin
  const top =
    spaceBelow >= height + offset
      ? anchor.bottom + offset
      : Math.max(margin, anchor.top - height - offset)

  return { left: clamp(preferredLeft, margin, maxLeft), top }
}
