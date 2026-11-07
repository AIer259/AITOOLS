import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatNodePath } from '../../lib/tree'
import { useTreeIndex } from '../../store/useTreeIndex'
import { DOC_TYPE_LABEL, type DocType, type TreeNode } from '../../types'
import { DocTypeIcon } from '../common/DocTypeIcon'

interface GraphDocPickerProps {
  selectedDocIds: ReadonlySet<string>
  onSelect: (doc: TreeNode) => void
  onClose: () => void
}

export function GraphDocPicker({ selectedDocIds, onSelect, onClose }: GraphDocPickerProps) {
  const index = useTreeIndex()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const docs = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return index.activeDocs.filter(
      (node) =>
        (node.docType ?? 'md') !== 'graph' &&
        !selectedDocIds.has(node.id) &&
        (!keyword || node.name.toLowerCase().includes(keyword)),
    )
  }, [index, query, selectedDocIds])

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="embed-picker"
        role="dialog"
        aria-modal="true"
        aria-label="添加文档到关系图"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="embed-picker-head">
          <div>
            <h3>添加文档</h3>
            <p>选择已有文档加入关系图，同一文档只会出现一次</p>
          </div>
          <button type="button" className="icon-button" title="关闭" onClick={onClose}>
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
            <div className="embed-empty">没有可添加的文档</div>
          ) : (
            docs.map((doc) => {
              const type = (doc.docType ?? 'md') as DocType
              return (
                <button
                  key={doc.id}
                  type="button"
                  className="embed-item"
                  onClick={() => {
                    onSelect(doc)
                  }}
                >
                  <span className="embed-item-icon">
                    <DocTypeIcon docType={type} size={16} />
                  </span>
                  <span className="embed-item-text">
                    <span className="embed-item-name">{doc.name}</span>
                    <span className="embed-item-path">{formatNodePath(index, doc)}</span>
                  </span>
                  <span className="embed-item-type">{DOC_TYPE_LABEL[type]}</span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
