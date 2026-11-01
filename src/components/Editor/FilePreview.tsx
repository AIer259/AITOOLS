import { useEffect, useState } from 'react'
import { loadBlob } from '../../lib/db'
import { useNoteStore } from '../../store/useNoteStore'
import type { TreeNode } from '../../types'

interface FilePreviewProps {
  node: TreeNode
}

export function FilePreview({ node }: FilePreviewProps) {
  const renameNode = useNoteStore((state) => state.renameNode)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [docxHtml, setDocxHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    setLoading(true)
    setError(null)
    setPdfUrl(null)
    setDocxHtml(null)

    if (!node.blobId) {
      setError('找不到原始文件')
      setLoading(false)
      return
    }

    loadBlob(node.blobId)
      .then(async (buffer) => {
        if (cancelled) return
        if (!buffer) {
          setError('找不到原始文件，可能已被清理')
          return
        }

        if (node.docType === 'pdf') {
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
  }, [node.id, node.blobId, node.docType])

  return (
    <div className="editor-scroll">
      <article className={`paper file-preview ${node.docType ?? 'docx'}`}>
        <input
          className="note-title"
          value={node.name}
          placeholder="未命名文件"
          aria-label="文件名"
          onChange={(event) => renameNode(node.id, event.target.value)}
          onBlur={() => {
            if (!node.name.trim()) renameNode(node.id, node.docType === 'pdf' ? 'PDF 文档' : 'Word 文档')
          }}
        />

        <div className="paper-meta">
          <span>{node.docType === 'pdf' ? 'PDF 文档' : 'Word 文档'}</span>
          <span className="meta-dot">·</span>
          <span>只读预览</span>
        </div>

        {loading ? (
          <div className="file-preview-empty">正在载入文件…</div>
        ) : error ? (
          <div className="file-preview-empty error">{error}</div>
        ) : node.docType === 'pdf' ? (
          pdfUrl ? (
            <iframe className="file-preview-pdf" src={pdfUrl} title={node.name} />
          ) : (
            <div className="file-preview-empty">正在准备 PDF…</div>
          )
        ) : docxHtml ? (
          <div
            className="note-prose file-preview-docx"
            dangerouslySetInnerHTML={{ __html: docxHtml }}
          />
        ) : (
          <div className="file-preview-empty">文档内容为空</div>
        )}
      </article>
    </div>
  )
}
