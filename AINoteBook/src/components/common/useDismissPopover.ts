import { useEffect, useRef, type RefObject } from 'react'

/** 弹层通用关闭逻辑：外部点击、滚动、缩放、Escape */
export function useDismissPopover(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  onEscape?: () => void,
): void {
  const closeRef = useRef(onClose)
  const escapeRef = useRef(onEscape)
  closeRef.current = onClose
  escapeRef.current = onEscape

  useEffect(() => {
    if (!open) return

    const isInside = (target: Node) =>
      Boolean(panelRef.current?.contains(target) || anchorRef.current?.contains(target))

    const handlePointerDown = (event: PointerEvent) => {
      if (!isInside(event.target as Node)) closeRef.current()
    }
    const handleScroll = (event: Event) => {
      if (!isInside(event.target as Node)) closeRef.current()
    }
    const handleResize = () => closeRef.current()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeRef.current()
      escapeRef.current?.()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [open, panelRef, anchorRef])
}
