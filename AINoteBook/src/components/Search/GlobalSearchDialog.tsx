import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { searchAll, type SearchResult } from '../../lib/searchIndex'
import { useNavigationStore } from '../../store/useNavigationStore'
import { useNoteStore } from '../../store/useNoteStore'
import { useUiStore } from '../../store/useUiStore'

function Snippet({ result }: { result: SearchResult }) {
  const { snippet, snippetMatchStart, snippetMatchLength } = result
  if (snippetMatchStart < 0 || snippetMatchLength === 0) return <>{snippet}</>

  const end = snippetMatchStart + snippetMatchLength
  return (
    <>
      {snippet.slice(0, snippetMatchStart)}
      <mark>{snippet.slice(snippetMatchStart, end)}</mark>
      {snippet.slice(end)}
    </>
  )
}

export function GlobalSearchDialog() {
  const open = useUiStore((state) => state.globalSearchOpen)
  const close = useUiStore((state) => state.closeGlobalSearch)
  const requestSearch = useUiStore((state) => state.requestSearch)
  const nodes = useNoteStore((state) => state.nodes)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setActive(0)
    setLoading(false)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const keyword = query.trim()
    if (!keyword) {
      requestRef.current += 1
      setResults([])
      setLoading(false)
      return
    }

    const requestId = ++requestRef.current
    setLoading(true)
    const timer = window.setTimeout(() => {
      void searchAll(keyword, nodes)
        .then((items) => {
          if (requestRef.current !== requestId) return
          setResults(items)
          setActive(0)
          setLoading(false)
        })
        .catch((error) => {
          if (requestRef.current !== requestId) return
          console.error('全局搜索失败', error)
          setResults([])
          setLoading(false)
        })
    }, 120)

    return () => window.clearTimeout(timer)
  }, [query, open, nodes])

  useEffect(() => {
    if (!open) return
    const current = document.querySelector('.global-search-result.active')
    current?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  if (!open) return null

  const openResult = (result: SearchResult) => {
    useNavigationStore.getState().openDocument(result.id)
    requestSearch(result.id, query.trim())
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (results.length ? (index + 1) % results.length : 0))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) =>
        results.length ? (index - 1 + results.length) % results.length : 0,
      )
      return
    }
    if (event.key === 'Enter' && results[active]) {
      event.preventDefault()
      openResult(results[active])
    }
  }

  return (
    <div
      className="global-search-backdrop"
      onMouseDown={close}
      role="presentation"
    >
      <div
        className="global-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="global-search-input-row">
          <Search size={17} className="global-search-icon" />
          <input
            ref={inputRef}
            className="global-search-input"
            value={query}
            placeholder="搜索全部笔记…"
            aria-label="搜索全部笔记"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="global-search-close"
            title="关闭全局搜索"
            onClick={close}
          >
            <X size={16} />
          </button>
        </div>

        <div className="global-search-results">
          {loading && <div className="global-search-state">正在建立搜索索引…</div>}
          {!loading && !query.trim() && (
            <div className="global-search-state">
              输入关键词搜索全部笔记，`Ctrl/Cmd + K` 可随时打开
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div className="global-search-state">没有找到匹配内容</div>
          )}
          {!loading &&
            results.map((result, index) => (
              <button
                type="button"
                key={result.id}
                className={`global-search-result${
                  index === active ? ' active' : ''
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => openResult(result)}
              >
                <span className="global-search-result-head">
                  <span className="global-search-name">{result.name}</span>
                  <span className="global-search-path">{result.path}</span>
                  {result.matches > 1 && (
                    <span className="global-search-count">
                      {result.matches} 处
                    </span>
                  )}
                </span>
                <span className="global-search-snippet">
                  <Snippet result={result} />
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
