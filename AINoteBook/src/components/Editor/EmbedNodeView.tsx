import { ChevronRight, File, FileText, FileType2, Trash2 } from 'lucide-react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { loadBlob } from '../../lib/db'
import { hydrateImageElements } from '../../lib/imageAssets'
import { docJsonToHtml } from '../../lib/renderDoc'
import { useNoteStore } from '../../store/useNoteStore'
import type { DocType } from '../../types'

const TYPE_LABEL: Record<DocType, string> = {
  md: 'Markdown',
  docx: 'Word',
  pdf: 'PDF',
}

function TypeIcon({ type }: { type: DocType }) {
  if (type === 'pdf') return <File size={15} />
  if (type === 'docx') return <FileType2 size={15} />
  return <FileText size={15} />
}

export function EmbedNodeView(props: NodeViewProps) {
  const docId = String(props.node.attrs.docId ?? '')
  const node = useNoteStore((state) => state.nodes.find((item) => item.id === docId))

  const [expanded, setExpanded] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [docxHtml, setDocxHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mdRef = useRef<HTMLDivElement>(null)

  const docType = (node?.docType ?? props.node.attrs.docType ?? 'md') as DocType
  const name = node?.name || String(props.node.attrs.name || '嵌入文档')
  const content = node?.content
  const blobId = node?.blobId

  const mdHtml = useMemo(
    () => (expanded && docType === 'md' ? docJsonToHtml(content) : ''),
    [expanded, docType, content],
  )

  useEffect(() => {
    setExpanded(false)
    setPdfUrl(null)
    setDocxHtml(null)
    setError(null)
  }, [docId])

  useEffect(() => {
    if (!expanded || !mdHtml || !mdRef.current) return

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
  }, [expanded, mdHtml])

  useEffect(() => {
    if (!expanded || !blobId || (docType !== 'pdf' && docType !== 'docx')) return

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
  }, [expanded, blobId, docType])

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
            <TypeIcon type={docType} />
          </span>
          <span className="embed-name">{name}</span>
          <span className="embed-badge">{TYPE_LABEL[docType]}</span>
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

      {expanded && <div className="embed-body">{renderBody()}</div>}
    </NodeViewWrapper>
  )
}
