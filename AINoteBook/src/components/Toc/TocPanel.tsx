import { ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  buildTocTree,
  extractToc,
  flattenToc,
  isTocCollapsed,
  type TocItem,
  type TocNode,
} from '../../lib/toc'
import { useNoteStore } from '../../store/useNoteStore'
import { useUiStore } from '../../store/useUiStore'

export function TocPanel() {
  const editor = useUiStore((state) => state.editor)
  const toggleToc = useUiStore((state) => state.toggleToc)
  const activeId = useNoteStore((state) => state.activeId)

  const [items, setItems] = useState<TocItem[]>([])
  const [activePos, setActivePos] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Map<string, boolean>>(new Map())

  const tree = useMemo(() => buildTocTree(items), [items])
  const rows = useMemo(() => flattenToc(tree, collapsed), [tree, collapsed])

  useEffect(() => {
    if (!editor) {
      setItems([])
      return
    }

    const update = () => setItems(extractToc(editor))
    update()
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor, activeId])

  useEffect(() => {
    setCollapsed(new Map())
    setActivePos(null)
  }, [activeId])

  const jumpTo = (item: TocItem) => {
    if (!editor) return
    editor.chain().focus().setTextSelection(item.pos + 1).scrollIntoView().run()
    setActivePos(item.pos)
  }

  const toggleCollapsed = (node: TocNode) => {
    setCollapsed((current) => {
      const next = new Map(current)
      next.set(node.id, !isTocCollapsed(node, current))
      return next
    })
  }

  return (
    <aside className="toc-panel">
      <div className="toc-head">
        <span>目录</span>
        <button type="button" className="icon-button" title="收起目录" onClick={toggleToc}>
          <X size={15} />
        </button>
      </div>

      <div className="toc-list">
        {rows.length === 0 ? (
          <div className="toc-empty">当前文档还没有标题</div>
        ) : (
          rows.map((node) => {
            const hasChildren = node.children.length > 0
            const isCollapsed = isTocCollapsed(node, collapsed)

            return (
              <div
                key={node.id}
                className="toc-row"
                style={{ paddingLeft: 4 + (node.level - 1) * 12 }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className={`toc-toggle${isCollapsed ? ' is-collapsed' : ''}`}
                    title={isCollapsed ? '展开下级目录' : '折叠下级目录'}
                    aria-label={isCollapsed ? '展开下级目录' : '折叠下级目录'}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleCollapsed(node)}
                  >
                    <ChevronRight size={13} />
                  </button>
                ) : (
                  <span className="toc-toggle-spacer" aria-hidden="true" />
                )}

                <button
                  type="button"
                  className={`toc-item level-${node.level}${activePos === node.pos ? ' active' : ''}`}
                  title={node.text}
                  onClick={() => jumpTo(node)}
                >
                  {node.text}
                </button>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
