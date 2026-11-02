import type { Editor } from '@tiptap/core'
import { Check, Copy, Globe, Pencil } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { copyTextToClipboard } from '../../lib/clipboard'
import {
  applyLink as applyLinkRange,
  getLinkRangeAt,
  removeLink as removeLinkRange,
  type LinkRange,
} from '../../lib/linkEditing'
import { placePanel } from '../../lib/popover'
import { useUiStore } from '../../store/useUiStore'
import { LinkEditorDialog } from './LinkEditorDialog'

interface LinkTarget extends LinkRange {
  rect: DOMRect
}

export function LinkTools({ editor }: { editor: Editor | null }) {
  const [hover, setHover] = useState<LinkTarget | null>(null)
  const [editing, setEditing] = useState<LinkTarget | null>(null)
  const [copied, setCopied] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const copyTimer = useRef<number | null>(null)

  const cancelHide = useCallback(() => {
    if (hideTimer.current === null) return
    window.clearTimeout(hideTimer.current)
    hideTimer.current = null
  }, [])

  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimer.current = window.setTimeout(() => setHover(null), 140)
  }, [cancelHide])

  useEffect(
    () => () => {
      cancelHide()
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    },
    [cancelHide],
  )

  useEffect(() => {
    if (!editor) return

    const dom = editor.view.dom
    if (!editor.schema.marks.link) return

    const showLink = (anchor: HTMLAnchorElement) => {
      // 有文字选区时优先显示选区工具条，不弹出链接卡片
      if (!editor.state.selection.empty) return
      if (!anchor.getAttribute('href')) return

      let pos = 0
      try {
        pos = editor.view.posAtDOM(anchor, 0)
      } catch {
        return
      }

      const range = getLinkRangeAt(editor, pos)
      if (!range) return

      cancelHide()
      setCopied(false)
      setHover({ ...range, rect: anchor.getBoundingClientRect() })
    }

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest('a')
      if (!anchor || !dom.contains(anchor)) return
      // 只处理可编辑正文中的链接，忽略嵌套文档预览里的只读链接
      if (anchor.closest('[contenteditable="false"]')) return

      const related = event.relatedTarget
      if (related instanceof Node && anchor.contains(related)) return
      showLink(anchor)
    }

    const handleMouseOut = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest('a')
      if (!anchor) return

      const related = event.relatedTarget
      if (related instanceof Node && anchor.contains(related)) return
      scheduleHide()
    }

    const hide = () => setHover(null)

    dom.addEventListener('mouseover', handleMouseOver)
    dom.addEventListener('mouseout', handleMouseOut)
    dom.addEventListener('mousedown', hide)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)

    return () => {
      dom.removeEventListener('mouseover', handleMouseOver)
      dom.removeEventListener('mouseout', handleMouseOut)
      dom.removeEventListener('mousedown', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      cancelHide()
    }
  }, [editor, cancelHide, scheduleHide])

  const handleCopy = async () => {
    if (!hover) return

    const copiedOk = await copyTextToClipboard(hover.href)
    if (!copiedOk) {
      useUiStore.getState().showToast('复制链接失败', 'error')
      return
    }

    setCopied(true)
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1200)
  }

  const openEditor = () => {
    if (!hover) return
    setEditing(hover)
    setHover(null)
  }

  const closeDialog = () => {
    setEditing(null)
    window.requestAnimationFrame(() => editor?.commands.focus())
  }

  const saveEditingLink = (url: string, title: string) => {
    if (!editor || !editing) return
    applyLinkRange(editor, editing, url, title)
    closeDialog()
  }

  const removeEditingLink = () => {
    if (!editor || !editing) return
    removeLinkRange(editor, editing)
    closeDialog()
  }

  const cardWidth = hover
    ? Math.min(Math.max(240, Math.min(400, hover.href.length * 7 + 88)), window.innerWidth - 16)
    : 240
  const cardPosition = hover
    ? placePanel(hover.rect, { width: cardWidth, height: 46 })
    : { left: 0, top: 0 }

  return (
    <>
      {hover &&
        !editing &&
        createPortal(
          <div
            className="link-hover-card"
            style={{ left: cardPosition.left, top: cardPosition.top, width: cardWidth }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Globe size={14} className="link-hover-icon" />
            <span className="link-hover-url" title={hover.href}>
              {hover.href}
            </span>
            <button
              type="button"
              className={`link-hover-action${copied ? ' is-copied' : ''}`}
              title={copied ? '已复制' : '复制链接'}
              aria-label="复制链接"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void handleCopy()}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button
              type="button"
              className="link-hover-action"
              title="修改链接"
              aria-label="修改链接"
              onMouseDown={(event) => event.preventDefault()}
              onClick={openEditor}
            >
              <Pencil size={14} />
            </button>
          </div>,
          document.body,
        )}

      {editing && (
        <LinkEditorDialog
          link={editing}
          onSave={saveEditingLink}
          onRemove={removeEditingLink}
          onCancel={closeDialog}
        />
      )}
    </>
  )
}
