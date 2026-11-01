import {
  ChevronRight,
  Code2,
  FileInput,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { SlashIcon, SlashItem } from '../../lib/slashCommands'

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export interface SlashMenuProps {
  items: SlashItem[]
  query: string
  command: (item: SlashItem) => void
}

const ICONS: Record<SlashIcon, LucideIcon> = {
  text: Pilcrow,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullet: List,
  ordered: ListOrdered,
  task: ListChecks,
  code: Code2,
  quote: Quote,
  callout: Lightbulb,
  divider: Minus,
  table: Table2,
  toggle: ChevronRight,
  embed: FileInput,
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(function SlashMenu(
  { items, query, command },
  ref,
) {
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelected(0)
  }, [items])

  useEffect(() => {
    listRef.current
      ?.querySelector('.slash-item.selected')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: (event) => {
        if (event.isComposing || items.length === 0) return false
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelected((current) => (current - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelected((current) => (current + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const item = items[selected]
          if (item) command(item)
          return true
        }
        return false
      },
    }),
    [items, selected, command],
  )

  return (
    <div className="slash-menu" role="listbox" aria-label="插入功能">
      <div className="slash-menu-head">{query ? `搜索「${query}」` : '插入内容'}</div>
      <div className="slash-list" ref={listRef}>
        {items.length === 0 ? (
          <div className="slash-empty">没有匹配的功能</div>
        ) : (
          items.map((item, index) => {
            const Icon = ICONS[item.icon]
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === selected}
                className={`slash-item${index === selected ? ' selected' : ''}`}
                onMouseEnter={() => setSelected(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  command(item)
                }}
              >
                <span className="slash-icon">
                  <Icon size={15} />
                </span>
                <span className="slash-text">
                  <span className="slash-title">{item.title}</span>
                  <span className="slash-hint">{item.hint}</span>
                </span>
              </button>
            )
          })
        )}
      </div>
      <div className="slash-menu-foot">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
    </div>
  )
})
