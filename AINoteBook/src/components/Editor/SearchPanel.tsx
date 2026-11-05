import { ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { findMatches, searchPluginKey, type SearchMatch } from '../../extensions/SearchHighlight'
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
  const [replacement, setReplacement] = useState('')
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const queryRef = useRef('')

  const dispatchSearch = (nextQuery: string, nextIndex: number) => {
    if (!editor) return
    const transaction = editor.state.tr
      .setMeta(searchPluginKey, { query: nextQuery, activeIndex: nextIndex })
      .setMeta('addToHistory', false)
    editor.view.dispatch(transaction)
  }

  const focusMatch = (match: SearchMatch) => {
    if (!editor) return
    editor.chain().setTextSelection(match.from).run()
    requestAnimationFrame(() => scrollCurrent(editor.view.dom))
  }

  const applyQuery = (value: string) => {
    setQuery(value)
    queryRef.current = value
    if (!editor) return

    const matches = findMatches(editor.state.doc, value)
    setCount(matches.length)
    setIndex(0)
    dispatchSearch(value, 0)

    if (matches.length > 0) focusMatch(matches[0])
  }

  // 正文内容变化时重算匹配数量（修复：编辑后数量不刷新）
  useEffect(() => {
    if (!editor || !open) return
    const handler = () => {
      if (!queryRef.current.trim()) return
      const matches = findMatches(editor.state.doc, queryRef.current)
      setCount(matches.length)
      setIndex((prev) => (matches.length === 0 ? 0 : Math.min(prev, matches.length - 1)))
    }
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
    }
  }, [editor, open])

  useEffect(() => {
    if (!editor && open && !pendingSearch) setOpen(false)
  }, [editor, open, pendingSearch, setOpen])

  useEffect(() => {
    if (!open) clearPendingSearch()
  }, [open, clearPendingSearch])

  useEffect(() => {
    if (!editor) return

    setQuery('')
    queryRef.current = ''
    setReplacement('')
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

    const matches = findMatches(editor.state.doc, query)
    const target = matches[next]
    if (target) focusMatch(target)
  }

  const replaceCurrent = () => {
    if (!editor || count === 0) return
    const matches = findMatches(editor.state.doc, query)
    const target = matches[Math.min(index, matches.length - 1)]
    if (!target) return
    editor
      .chain()
      .command(({ tr }) => {
        if (replacement === '') tr.delete(target.from, target.to)
        else tr.replaceWith(target.from, target.to, editor.state.schema.text(replacement))
        return true
      })
      .run()
  }

  const replaceAll = () => {
    if (!editor || count === 0) return
    const matches = findMatches(editor.state.doc, query)
    if (matches.length === 0) return
    editor
      .chain()
      .command(({ tr }) => {
        for (let i = matches.length - 1; i >= 0; i--) {
          const match = matches[i]
          if (replacement === '') tr.delete(match.from, match.to)
          else tr.replaceWith(match.from, match.to, editor.state.schema.text(replacement))
        }
        return true
      })
      .run()
  }

  const close = () => {
    setOpen(false)
    editor?.commands.focus()
  }

  return (
    <div className="search-panel" role="search">
      <div className="search-panel-row">
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

      {query && count > 0 && (
        <div className="search-panel-row search-panel-replace">
          <Replace size={15} className="search-panel-icon" />
          <input
            value={replacement}
            placeholder="替换为…"
            aria-label="替换为"
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                replaceCurrent()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
          />
          <button type="button" className="search-replace-btn" onClick={replaceCurrent}>
            替换
          </button>
          <button type="button" className="search-replace-btn" onClick={replaceAll}>
            全部替换
          </button>
        </div>
      )}
    </div>
  )
}
