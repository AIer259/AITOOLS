import { Check, ChevronDown, Copy, Search } from 'lucide-react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { copyTextToClipboard } from '../../lib/clipboard'
import {
  filterCodeLanguages,
  getCodeLanguage,
  normalizeCodeLanguage,
  PLAIN_TEXT_ID,
} from '../../lib/codeLanguages'
import { placePanel, type PanelPosition } from '../../lib/popover'
import { useUiStore } from '../../store/useUiStore'
import { useDismissPopover } from '../common/useDismissPopover'

const MENU_WIDTH = 264
const MENU_MAX_HEIGHT = 300

function measureMenuPosition(button: HTMLButtonElement): PanelPosition {
  return placePanel(button.getBoundingClientRect(), {
    width: MENU_WIDTH,
    height: MENU_MAX_HEIGHT,
  })
}

export function CodeBlockView(props: NodeViewProps) {
  const language = normalizeCodeLanguage(props.node.attrs.language)
  const current = getCodeLanguage(language)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [position, setPosition] = useState<PanelPosition>({ left: 0, top: 0 })
  const [copied, setCopied] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const copyTimer = useRef<number | null>(null)

  // 名称输入框保持非受控，避免输入法组合期间 React 回写 value 导致字符重复
  useEffect(() => {
    const input = nameInputRef.current
    if (!input || document.activeElement === input) return

    const name = String(props.node.attrs.codeName ?? '')
    if (input.value !== name) input.value = name
  }, [props.node.attrs.codeName])

  const results = useMemo(() => filterCodeLanguages(query), [query])
  const activeIndex = Math.min(selected, Math.max(0, results.length - 1))

  const closeMenu = () => {
    setOpen(false)
    setQuery('')
    setSelected(0)
  }

  const openMenu = () => {
    const button = buttonRef.current
    if (button) setPosition(measureMenuPosition(button))
    setQuery('')
    setSelected(0)
    setOpen(true)
  }

  const selectLanguage = (id: string) => {
    props.updateAttributes({ language: id === PLAIN_TEXT_ID ? null : id })
    closeMenu()
    window.requestAnimationFrame(() => props.editor.commands.focus())
  }

  const handleCopy = async () => {
    const copiedOk = await copyTextToClipboard(props.node.textContent)

    if (!copiedOk) {
      useUiStore.getState().showToast('复制失败，请手动选择代码复制', 'error')
      return
    }

    setCopied(true)
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    [],
  )

  const handleNameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()

    if (event.key === 'Enter') {
      event.preventDefault()
      props.editor.commands.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useDismissPopover(open, menuRef, buttonRef, closeMenu, () => buttonRef.current?.focus())

  useEffect(() => {
    if (!open) return
    menuRef.current
      ?.querySelector('.note-code-lang-item.selected')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, results])

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()

    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      buttonRef.current?.focus()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (results.length > 0) {
        setSelected((currentIndex) => (currentIndex + 1) % results.length)
      }
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length > 0) {
        setSelected((currentIndex) => (currentIndex - 1 + results.length) % results.length)
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const item = results[activeIndex]
      if (item) selectLanguage(item.id)
    }
  }

  return (
    <NodeViewWrapper
      className={`note-code-block${props.selected ? ' is-selected' : ''}`}
      data-language={language ?? PLAIN_TEXT_ID}
    >
      <div className="note-code-head" contentEditable={false}>
        <input
          ref={nameInputRef}
          className="note-code-name"
          defaultValue={String(props.node.attrs.codeName ?? '')}
          placeholder="请输入代码块名称"
          aria-label="代码块名称"
          spellCheck={false}
          onChange={(event) => props.updateAttributes({ codeName: event.target.value })}
          onKeyDown={handleNameKeyDown}
        />

        <div className="note-code-actions">
          <button
            ref={buttonRef}
            type="button"
            className={`note-code-lang${open ? ' is-open' : ''}`}
            title="设置代码语言"
            aria-haspopup="listbox"
            aria-expanded={open}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => (open ? closeMenu() : openMenu())}
          >
            <span>{current.label}</span>
            <ChevronDown size={13} />
          </button>

          <button
            type="button"
            className={`note-code-copy${copied ? ' is-copied' : ''}`}
            title="复制代码"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void handleCopy()}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      </div>

      <pre
        data-language={language ?? undefined}
        data-language-label={language ? current.label : undefined}
      >
        <NodeViewContent<'code'>
          as="code"
          className={language ? `language-${language}` : undefined}
        />
      </pre>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="note-code-lang-menu"
            style={{ left: position.left, top: position.top }}
            role="listbox"
            aria-label="选择代码语言"
          >
            <div className="note-code-lang-search">
              <Search size={14} />
              <input
                ref={inputRef}
                value={query}
                placeholder="搜索语言，如 python、js"
                aria-label="搜索编程语言"
                spellCheck={false}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setSelected(0)
                }}
                onKeyDown={handleSearchKeyDown}
              />
            </div>

            <div className="note-code-lang-list">
              {results.length === 0 ? (
                <div className="note-code-lang-empty">没有匹配的语言</div>
              ) : (
                results.map((item, index) => {
                  const isSelected = index === activeIndex
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`note-code-lang-item${isSelected ? ' selected' : ''}`}
                      onMouseEnter={() => setSelected(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectLanguage(item.id)}
                    >
                      <span>{item.label}</span>
                      <span className="note-code-lang-id">{item.id}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  )
}
