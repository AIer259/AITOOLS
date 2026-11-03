import { Trash2, X, ZoomIn } from 'lucide-react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { getAssetMeta, loadAssetBlob, type AssetMeta } from '../../lib/imageAssets'

export function ImageNodeView(props: NodeViewProps) {
  const assetId = String(props.node.attrs.assetId ?? '')
  const alt = String(props.node.attrs.alt ?? '')

  const [url, setUrl] = useState<string | null>(null)
  const [meta, setMeta] = useState<AssetMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    setUrl(null)
    setMeta(null)
    setError(null)
    setArmed(false)
    setLightboxOpen(false)

    if (!assetId) {
      setError('图片资源缺失')
      return
    }

    Promise.all([getAssetMeta(assetId), loadAssetBlob(assetId)])
      .then(([assetMeta, blob]) => {
        if (cancelled) return
        setMeta(assetMeta ?? null)
        if (!blob) {
          setError('图片资源不存在')
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setError('图片加载失败')
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [assetId])

  useEffect(() => {
    if (!lightboxOpen) return

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [lightboxOpen])

  const handleImageClick = (event: MouseEvent<HTMLImageElement>) => {
    event.stopPropagation()
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    setLightboxOpen(true)
  }

  const aspectRatio =
    meta && meta.width > 0 && meta.height > 0 ? `${meta.width} / ${meta.height}` : undefined

  return (
    <NodeViewWrapper
      className={`note-image${armed ? ' armed' : ''}`}
      contentEditable={false}
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
      onMouseLeave={() => {
        if (!lightboxOpen) setArmed(false)
      }}
    >
      <div className="note-image-frame">
        {url ? (
          <img
            className="note-image-img"
            src={url}
            alt={alt}
            title={alt}
            draggable={false}
            onClick={handleImageClick}
          />
        ) : (
          <div className="note-image-placeholder" style={{ aspectRatio }}>
            <span>{error ?? '图片加载中…'}</span>
          </div>
        )}

        {armed && url && (
          <span className="note-image-zoom-hint">
            <ZoomIn size={24} />
            <span>再次点击放大</span>
          </span>
        )}

        <button
          type="button"
          className="note-image-remove"
          title="删除图片"
          onClick={(event) => {
            event.stopPropagation()
            props.deleteNode()
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {lightboxOpen &&
        url &&
        createPortal(
          <div
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="放大查看图片"
            onClick={() => setLightboxOpen(false)}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="image-lightbox-close"
              title="关闭"
              aria-label="关闭图片预览"
              onClick={(event) => {
                event.stopPropagation()
                setLightboxOpen(false)
              }}
            >
              <X size={16} />
            </button>
            <img
              src={url}
              alt={alt}
              onClick={(event) => event.stopPropagation()}
            />
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  )
}
