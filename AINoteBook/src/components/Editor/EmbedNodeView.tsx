import type { JSONContent } from '@tiptap/core'
import { ChevronRight, Maximize2, Trash2, X } from 'lucide-react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { loadBlob } from '../../lib/db'
import { hydrateImageElements } from '../../lib/imageAssets'
import { docJsonToHtml } from '../../lib/renderDoc'
import { useNoteStore } from '../../store/useNoteStore'
import { useTreeIndex } from '../../store/useTreeIndex'
import { DOC_TYPE_LABEL, type DocType } from '../../types'
import { DocTypeIcon } from '../common/DocTypeIcon'

export function EmbedNodeView(props: NodeViewProps) {
  const docId = String(props.node.attrs.docId ?? '')
  const index = useTreeIndex()
  const node = index.byId.get(docId)
  const readContent = useNoteStore((state) => state.readContent)

  const [expanded, setExpanded] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [docxHtml, setDocxHtml] = useState<string | null>(null)
  const [content, setContent] = useState<JSONContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mdRef = useRef<HTMLDivElement>(null)

  const docType = (node?.docType ?? props.node.attrs.docType ?? 'md') as DocType
  const name = node?.name || String(props.node.attrs.name || '嵌入文档')
  const blobId = node?.blobId
  const open = expanded || fullscreen

  const mdHtml = useMemo(
    () => (open && docType === 'md' ? docJsonToHtml(content ?? undefined) : ''),
    [open, docType, content],
  )

  useEffect(() => {
    setExpanded(false)
    setFullscreen(false)
    setPdfUrl(null)
    setDocxHtml(null)
    setContent(null)
    setError(null)
  }, [docId])

  useEffect(() => {
    if (!fullscreen) return

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [fullscreen])

  useEffect(() => {
    if (!open || docType !== 'md' || !docId) {
      setContent(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setContent(null)

    readContent(docId)
      .then((next) => {
        if (!cancelled) setContent(next ?? null)
      })
      .catch((loadError) => {
        console.error(loadError)
        if (!cancelled) setError('文档加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, docType, docId, readContent])

  useEffect(() => {
    if (!open || !mdHtml || !mdRef.current) return

    let cancelled = false
    let cleanup: (() => void) | undefined

    void hydrateImageElements(mdRef.current).then((release) => {
      if (cancelled) release()
      else cleanup = release
    })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [open, mdHtml])

  useEffect(() => {
    if (!open || !blobId || (docType !== 'pdf' && docType !== 'docx')) return

    let cancelled = false
    let objectUrl: string | null = null

    setLoading(true)
    setError(null)
    setPdfUrl(null)
    setDocxHtml(null)

    loadBlob(blobId)
      .then(async (buffer) => {
        if (cancelled) return
        if (!buffer) {
          setError('找不到原始文件，可能已被清理')
          return
        }

        if (docType === 'pdf') {
          objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }))
          setPdfUrl(objectUrl)
          return
        }

        const mammoth = await import('mammoth')
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
        if (!cancelled) setDocxHtml(result.value)
      })
      .catch((loadError) => {
        console.error(loadError)
        if (!cancelled) setError('文件加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [open, blobId, docType])

  const renderBody = () => {
    if (!node) return <div className="embed-empty">引用的文档不存在或已删除</div>
    if (error) return <div className="embed-empty">{error}</div>
    if (loading) return <div className="embed-empty">正在载入文件…</div>

    if (docType === 'pdf') {
      return pdfUrl ? (
        <iframe className="embed-pdf" src={pdfUrl} title={name} />
      ) : (
        <div className="embed-empty">正在准备 PDF…</div>
      )
    }

    if (docType === 'docx') {
      return docxHtml ? (
        <div className="note-prose embed-docx" dangerouslySetInnerHTML={{ __html: docxHtml }} />
      ) : (
        <div className="embed-empty">正在载入 Word 文档…</div>
      )
    }

    return mdHtml ? (
      <div
        ref={mdRef}
        className="note-prose embed-md"
        dangerouslySetInnerHTML={{ __html: mdHtml }}
      />
    ) : (
      <div className="embed-empty">文档内容为空</div>
    )
  }

  return (
    <NodeViewWrapper
      className="embed-node"
      contentEditable={false}
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
    >
      <div className="embed-head">
        <button
          type="button"
          className="embed-main"
          onClick={() => setExpanded((value) => !value)}
          title={expanded ? '收起预览' : '展开预览'}
        >
          <span className={`embed-chevron${expanded ? ' open' : ''}`}>
            <ChevronRight size={14} />
          </span>
          <span className="embed-icon">
            <DocTypeIcon docType={docType} size={15} />
          </span>
          <span className="embed-name">{name}</span>
          <span className="embed-badge">{DOC_TYPE_LABEL[docType]}</span>
        </button>
        <button
          type="button"
          className="embed-zoom"
          title="全屏查看"
          aria-label="全屏查看嵌入文档"
          onClick={() => setFullscreen(true)}
        >
          <Maximize2 size={14} />
        </button>
        <button
          type="button"
          className="embed-remove"
          title="移除嵌入"
          onClick={() => props.deleteNode()}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && !fullscreen && <div className="embed-body">{renderBody()}</div>}

      {fullscreen &&
        createPortal(
          <div
            className="embed-fullscreen"
            role="dialog"
            aria-modal="true"
            aria-label={`全屏查看 ${name}`}
          >
            <div className="embed-fullscreen-head">
              <span className="embed-icon">
                <DocTypeIcon docType={docType} size={16} />
              </span>
              <span className="embed-name">{name}</span>
              <span className="embed-badge">{DOC_TYPE_LABEL[docType]}</span>
              <button
                type="button"
                className="embed-fullscreen-close"
                title="关闭全屏"
                aria-label="关闭全屏"
                onClick={() => setFullscreen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="embed-fullscreen-body">{renderBody()}</div>
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  )
}
