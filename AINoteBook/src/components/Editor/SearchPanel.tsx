import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { findMatches, searchPluginKey } from '../../extensions/SearchHighlight'
import { useNoteStore } from '../../store/useNoteStore'
import { useUiStore } from '../../store/useUiStore'

function scrollCurrent(box: HTMLElement) {
  const current = box.querySelector('.search-hit.current')
  current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

export function SearchPanel() {
  const editor = useUiStore((state) => state.editor)
  const contentReadyId = useUiStore((state) => state.contentReadyId)
  const open = useUiStore((state) => state.searchOpen)
  const setOpen = useUiStore((state) => state.setSearchOpen)
  const pendingSearch = useUiStore((state) => state.pendingSearch)
  const clearPendingSearch = useUiStore((state) => state.clearPendingSearch)
  const activeId = useNoteStore((state) => state.activeId)

  const [query, setQuery] = useState('')
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const dispatchSearch = (nextQuery: string, nextIndex: number) => {
    if (!editor) return
    const transaction = editor.state.tr
      .setMeta(searchPluginKey, { query: nextQuery, activeIndex: nextIndex })
      .setMeta('addToHistory', false)
    editor.view.dispatch(transaction)
  }

  const applyQuery = (value: string) => {
    setQuery(value)
    if (!editor) return

    const matches = findMatches(editor.state.doc, value)
    setCount(matches.length)
    setIndex(0)
    dispatchSearch(value, 0)

    if (matches.length > 0) {
      requestAnimationFrame(() => scrollCurrent(editor.view.dom))
    }
  }

  useEffect(() => {
    if (!editor && open && !pendingSearch) setOpen(false)
  }, [editor, open, pendingSearch, setOpen])

  useEffect(() => {
    if (!open) clearPendingSearch()
  }, [open, clearPendingSearch])

  useEffect(() => {
    if (!editor) return

    setQuery('')
    setCount(0)
    setIndex(0)
    dispatchSearch('', 0)

    if (!open) return

    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeId, editor])

  useEffect(() => {
    if (!open || !editor || !pendingSearch) return
    if (pendingSearch.docId !== activeId || contentReadyId !== activeId) return

    applyQuery(pendingSearch.query)
    clearPendingSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editor, activeId, contentReadyId, pendingSearch, clearPendingSearch])

  if (!open) return null

  const go = (delta: number) => {
    if (!editor || count === 0) return
    const next = (index + delta + count) % count
    setIndex(next)
    dispatchSearch(query, next)
    requestAnimationFrame(() => scrollCurrent(editor.view.dom))
  }

  const close = () => {
    setOpen(false)
    editor?.commands.focus()
  }

  return (
    <div className="search-panel" role="search">
      <Search size={15} className="search-panel-icon" />
      <input
        ref={inputRef}
        value={query}
        placeholder="在当前文档中搜索…"
        aria-label="在当前文档中搜索"
        onChange={(event) => applyQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            go(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
      />
      <span className={`search-count${query && count === 0 ? ' empty' : ''}`}>
        {query ? (count > 0 ? `${index + 1}/${count}` : '无结果') : ''}
      </span>
      <button
        type="button"
        className="search-icon-btn"
        title="上一处"
        disabled={count === 0}
        onClick={() => go(-1)}
      >
        <ChevronUp size={15} />
      </button>
      <button
        type="button"
        className="search-icon-btn"
        title="下一处"
        disabled={count === 0}
        onClick={() => go(1)}
      >
        <ChevronDown size={15} />
      </button>
      <button type="button" className="search-icon-btn" title="关闭搜索" onClick={close}>
        <X size={15} />
      </button>
    </div>
  )
}
