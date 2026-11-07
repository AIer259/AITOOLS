import { ImagePlus, Trash2 } from 'lucide-react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { recognizeMathImage } from '../../lib/mathOcr'
import { renderMathHtml } from '../../lib/mathRender'

interface MathEditorProps {
  initial: string
  displayMode: boolean
  onSave: (latex: string) => void
  onDelete: () => void
  onCancel: () => void
}

function MathEditor({ initial, displayMode, onSave, onDelete, onCancel }: MathEditorProps) {
  const [value, setValue] = useState(initial)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrMessage, setOcrMessage] = useState('')
  const [ocrError, setOcrError] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const thumbRef = useRef<string | null>(null)
  const preview = useMemo(() => renderMathHtml(value, displayMode), [value, displayMode])

  useEffect(() => {
    const area = areaRef.current
    area?.focus()
    area?.select()
  }, [])

  useEffect(() => {
    return () => {
      if (thumbRef.current) URL.revokeObjectURL(thumbRef.current)
    }
  }, [])

  const handleImage = async (file: File) => {
    if (thumbRef.current) URL.revokeObjectURL(thumbRef.current)
    const url = URL.createObjectURL(file)
    thumbRef.current = url
    setImageUrl(url)
    setOcrError(false)
    setOcrBusy(true)
    setOcrMessage('正在准备识别模型（首次约 360MB，之后离线）…')

    try {
      const latex = await recognizeMathImage(file, (progress) => {
        if (progress.status === 'progress' && progress.progress > 0) {
          setOcrMessage(`正在下载识别模型 ${Math.round(progress.progress)}%`)
        } else if (progress.status === 'done') {
          setOcrMessage('模型就绪，正在识别公式…')
        }
      })

      if (!latex) {
        setOcrError(true)
        setOcrMessage('没有识别到公式，请换一张更清晰的图片')
      } else {
        setValue(latex)
        setOcrMessage('识别完成，可继续修改')
      }
    } catch (error) {
      console.error(error)
      setOcrError(true)
      setOcrMessage('识别失败，请检查网络后重试')
    } finally {
      setOcrBusy(false)
    }
  }

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

  const submit = () => onSave(value.trim())

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog math-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="编辑公式"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="math-field">
          <span>LaTeX 公式</span>
          <textarea
            ref={areaRef}
            value={value}
            rows={3}
            placeholder="例如 E=mc^2"
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
        </label>

        <div className="math-ocr">
          <button
            type="button"
            className="math-ocr-btn"
            disabled={ocrBusy}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={14} />
            <span>{ocrBusy ? '识别中…' : '上传图片识别'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleImage(file)
            }}
          />
          {imageUrl && <img className="math-ocr-thumb" src={imageUrl} alt="公式图片" />}
          {ocrMessage && (
            <span className={`math-ocr-status${ocrError ? ' error' : ''}`}>{ocrMessage}</span>
          )}
        </div>

        <div className="math-preview">
          <span className="math-preview-label">预览</span>
          <div
            className={`math-preview-body${displayMode ? ' is-block' : ''}`}
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        </div>

        <div className="math-dialog-actions">
          <button type="button" className="math-delete" onClick={onDelete}>
            <Trash2 size={14} />
            <span>删除公式</span>
          </button>
          <div className="link-dialog-buttons">
            <button type="button" className="btn ghost" onClick={onCancel}>
              取消
            </button>
            <button type="button" className="btn primary" onClick={submit}>
              确定
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function MathNodeView(props: NodeViewProps) {
  const latex = String(props.node.attrs.latex ?? '')
  const displayMode = props.node.type.name === 'mathBlock'
  const [editing, setEditing] = useState(false)
  const html = useMemo(() => renderMathHtml(latex, displayMode), [latex, displayMode])

  return (
    <NodeViewWrapper
      as={displayMode ? 'div' : 'span'}
      className={`math-node${displayMode ? ' math-block' : ' math-inline'}`}
      data-latex={latex}
      contentEditable={false}
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
    >
      <span
        className="math-render"
        title="点击编辑公式"
        onClick={() => setEditing(true)}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {editing && (
        <MathEditor
          initial={latex}
          displayMode={displayMode}
          onSave={(next) => {
            props.updateAttributes({ latex: next })
            setEditing(false)
          }}
          onDelete={() => {
            setEditing(false)
            props.deleteNode()
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </NodeViewWrapper>
  )
}
