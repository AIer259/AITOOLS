import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  applySidebarWidth,
  clampSidebarWidth,
} from '../../lib/sidebarLayout'
import { useUiStore } from '../../store/useUiStore'

const KEY_STEP = 16

interface DragState {
  startX: number
  startWidth: number
  width: number
}

export function SidebarResizer() {
  const width = useUiStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const dragRef = useRef<DragState | null>(null)
  const [dragging, setDragging] = useState(false)

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return

    dragRef.current = null
    setDragging(false)
    document.body.classList.remove('is-resizing')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setSidebarWidth(drag.width)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startWidth: width, width }
    setDragging(true)
    document.body.classList.add('is-resizing')
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return

    drag.width = clampSidebarWidth(drag.startWidth + event.clientX - drag.startX)
    applySidebarWidth(drag.width)
  }

  const resetWidth = () => {
    applySidebarWidth(SIDEBAR_DEFAULT_WIDTH)
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()

    const delta = event.key === 'ArrowLeft' ? -KEY_STEP : KEY_STEP
    const next = clampSidebarWidth(width + delta)
    applySidebarWidth(next)
    setSidebarWidth(next)
  }

  return (
    <div
      className={`sidebar-resizer${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      title="拖拽调整侧栏宽度，双击恢复默认"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={resetWidth}
      onKeyDown={handleKeyDown}
    />
  )
}
