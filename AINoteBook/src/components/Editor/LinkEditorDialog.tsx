import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LinkRange } from '../../lib/linkEditing'

interface LinkEditorDialogProps {
  link: LinkRange
  onSave: (url: string, title: string) => void
  onRemove: () => void
  onCancel: () => void
}

export function LinkEditorDialog({
  link,
  onSave,
  onRemove,
  onCancel,
}: LinkEditorDialogProps) {
  const [url, setUrl] = useState(link.href)
  const [title, setTitle] = useState(link.text || link.href)
  const urlRef = useRef<HTMLInputElement>(null)
  const canRemove = Boolean(link.href)

  useEffect(() => {
    const input = urlRef.current
    input?.focus()
    input?.select()
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [onCancel])

  const submit = () => {
    const nextUrl = url.trim()
    const nextTitle = title.trim()
    if (!nextUrl || !nextTitle) return
    onSave(nextUrl, nextTitle)
  }

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog link-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="链接设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="link-field">
          <span>页面或 URL</span>
          <input
            ref={urlRef}
            value={url}
            placeholder="https://"
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
          />
        </label>

        <label className="link-field">
          <span>链接标题</span>
          <input
            value={title}
            placeholder="链接显示的文字"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
          />
        </label>

        <div className={`link-dialog-actions${canRemove ? '' : ' no-remove'}`}>
          {canRemove && (
            <button type="button" className="link-delete" onClick={onRemove}>
              <Trash2 size={14} />
              <span>删除链接</span>
            </button>
          )}

          <div className="link-dialog-buttons">
            <button type="button" className="btn ghost" onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={submit}
              disabled={!url.trim() || !title.trim()}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
