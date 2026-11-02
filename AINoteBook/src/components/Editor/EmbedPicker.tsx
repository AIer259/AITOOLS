import { File, FileText, FileType2, Search, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { insertDocumentEmbed, uploadDocumentFile } from '../../lib/documentFiles'
import { importDocument } from '../../lib/fileImport'
import { getPath } from '../../lib/tree'
import { useNoteStore } from '../../store/useNoteStore'
import { useUiStore } from '../../store/useUiStore'
import { AREA_LABEL, DOC_TYPE_LABEL, type DocType, type TreeNode } from '../../types'

const UPLOAD_TYPES = [
  { kind: 'md', label: 'Markdown', extensions: ['.md', '.markdown'], mime: 'text/markdown' },
  { kind: 'pdf', label: 'PDF', extensions: ['.pdf'], mime: 'application/pdf' },
  {
    kind: 'docx',
    label: 'Word',
    extensions: ['.docx'],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
] as const

const UPLOAD_ACCEPT = UPLOAD_TYPES.flatMap((item) => [...item.extensions, item.mime]).join(',')
const UPLOAD_ERROR = `仅支持 ${UPLOAD_TYPES.map((item) => item.label).join('、')} 文件`

function detectUploadType(name: string): DocType | null {
  const lower = name.toLowerCase()
  return (
    UPLOAD_TYPES.find((item) => item.extensions.some((ext) => lower.endsWith(ext)))?.kind ?? null
  )
}

function DocIcon({ type }: { type: DocType }) {
  if (type === 'pdf') return <File size={16} />
  if (type === 'docx') return <FileType2 size={16} />
  return <FileText size={16} />
}

export function EmbedPicker() {
  const open = useUiStore((state) => state.embedPickerOpen)
  const insertPos = useUiStore((state) => state.embedInsertPos)
  const closePicker = useUiStore((state) => state.closeEmbedPicker)
  const editor = useUiStore((state) => state.editor)
  const showToast = useUiStore((state) => state.showToast)

  const nodes = useNoteStore((state) => state.nodes)
  const activeId = useNoteStore((state) => state.activeId)

  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const docs = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return nodes.filter(
      (node) =>
        node.kind === 'doc' &&
        node.id !== activeId &&
        (!keyword || node.name.toLowerCase().includes(keyword)),
    )
  }, [nodes, activeId, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePicker()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, closePicker])

  if (!open) return null

  const insert = (doc: TreeNode) => {
    if (!editor || insertPos === null) {
      showToast('当前没有可插入的编辑区', 'error')
      return
    }
    insertDocumentEmbed(editor, insertPos, doc)
    closePicker()
  }

  const handleUpload = async (file: File) => {
    if (!editor || insertPos === null) return
    const kind = detectUploadType(file.name)

    if (!kind) {
      showToast(UPLOAD_ERROR, 'error')
      return
    }

    setBusy(true)
    try {
      const doc =
        kind === 'md'
          ? await importDocument(file, 'md', { activate: false })
          : await uploadDocumentFile(file, kind)
      insertDocumentEmbed(editor, insertPos, doc)
      showToast(`已嵌入「${doc.name}」`, 'success')
      closePicker()
    } catch (error) {
      console.error(error)
      const message =
        error instanceof Error && error.message === '文件内容为空'
          ? 'Markdown 文件内容为空'
          : '文件上传失败，请重试'
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const pathLabel = (doc: TreeNode) => {
    const parents = getPath(nodes, doc.id).slice(0, -1)
    return [AREA_LABEL[doc.area], ...parents.map((node) => node.name)].join(' / ')
  }

  return (
    <div className="dialog-backdrop" onMouseDown={closePicker}>
      <div
        className="embed-picker"
        role="dialog"
        aria-modal="true"
        aria-label="嵌入文档"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="embed-picker-head">
          <div>
            <h3>嵌入文档</h3>
            <p>选择已有文档，或上传 Markdown / PDF / Word 文件</p>
          </div>
          <button type="button" className="icon-button" title="关闭" onClick={closePicker}>
            <X size={15} />
          </button>
        </div>

        <div className="embed-search">
          <Search size={14} />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索文档名称…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="embed-list">
          {docs.length === 0 ? (
            <div className="embed-empty">没有找到可嵌入的文档</div>
          ) : (
            docs.map((doc) => {
              const type = (doc.docType ?? 'md') as DocType
              return (
                <button
                  key={doc.id}
                  type="button"
                  className="embed-item"
                  onClick={() => insert(doc)}
                >
                  <span className="embed-item-icon">
                    <DocIcon type={type} />
                  </span>
                  <span className="embed-item-text">
                    <span className="embed-item-name">{doc.name}</span>
                    <span className="embed-item-path">{pathLabel(doc)}</span>
                  </span>
                  <span className="embed-item-type">{DOC_TYPE_LABEL[type]}</span>
                </button>
              )
            })
          )}
        </div>

        <div className="embed-picker-foot">
          <span className="embed-picker-hint">支持 Markdown、PDF、Word</span>
          <div className="embed-picker-actions">
            <button type="button" className="btn ghost" onClick={closePicker}>
              取消
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} />
              {busy ? '上传中…' : '上传文件'}
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleUpload(file)
          }}
        />
      </div>
    </div>
  )
}
