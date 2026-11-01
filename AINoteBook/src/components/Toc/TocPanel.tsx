import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { extractToc, type TocItem } from '../../lib/toc'
import { useNoteStore } from '../../store/useNoteStore'
import { useUiStore } from '../../store/useUiStore'

export function TocPanel() {
  const editor = useUiStore((state) => state.editor)
  const toggleToc = useUiStore((state) => state.toggleToc)
  const activeId = useNoteStore((state) => state.activeId)

  const [items, setItems] = useState<TocItem[]>([])
  const [activePos, setActivePos] = useState<number | null>(null)

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

  const jumpTo = (item: TocItem) => {
    if (!editor) return
    editor.chain().focus().setTextSelection(item.pos + 1).scrollIntoView().run()
    setActivePos(item.pos)
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
        {items.length === 0 ? (
          <div className="toc-empty">当前文档还没有标题</div>
        ) : (
          items.map((item) => (
            <button
              key={item.pos}
              type="button"
              className={`toc-item level-${item.level}${activePos === item.pos ? ' active' : ''}`}
              style={{ paddingLeft: 12 + (item.level - 1) * 12 }}
              title={item.text}
              onClick={() => jumpTo(item)}
            >
              {item.text}
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
