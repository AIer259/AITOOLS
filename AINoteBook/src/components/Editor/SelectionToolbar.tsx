import type { Editor } from '@tiptap/core'
import { AllSelection, TextSelection, type EditorState } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  Ban,
  Bold,
  ChevronDown,
  Italic,
  Link2,
  Palette,
  Underline,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  applyLink,
  getSelectionLinkRange,
  removeLink,
  type LinkRange,
} from '../../lib/linkEditing'
import { placePanel } from '../../lib/popover'
import { useUiStore } from '../../store/useUiStore'
import { useDismissPopover } from '../common/useDismissPopover'
import { LinkEditorDialog } from './LinkEditorDialog'

const PANEL_WIDTH = 320
const PANEL_HEIGHT = 420
const BUBBLE_OPTIONS = { placement: 'top' as const, offset: 8 }
const appendBubbleTo = () => document.body

const TEXT_COLORS = [
  { label: '红色', value: '#e5484d' },
  { label: '橙色', value: '#f76b15' },
  { label: '黄色', value: '#c99a00' },
  { label: '绿色', value: '#2f9e5c' },
  { label: '青色', value: '#0e9c93' },
  { label: '蓝色', value: '#0b7fd4' },
  { label: '紫色', value: '#7c5cbf' },
  { label: '粉色', value: '#d6409f' },
  { label: '灰色', value: '#7a7a75' },
  { label: '棕色', value: '#9a6a3a' },
]

const BACKGROUND_COLORS = [
  { label: '灰色', value: 'rgba(120, 119, 116, 0.28)' },
  { label: '棕色', value: 'rgba(159, 107, 83, 0.28)' },
  { label: '橙色', value: 'rgba(217, 115, 13, 0.28)' },
  { label: '黄色', value: 'rgba(203, 145, 47, 0.3)' },
  { label: '绿色', value: 'rgba(68, 131, 97, 0.28)' },
  { label: '青色', value: 'rgba(18, 165, 148, 0.28)' },
  { label: '蓝色', value: 'rgba(51, 126, 169, 0.28)' },
  { label: '紫色', value: 'rgba(144, 101, 176, 0.3)' },
  { label: '粉色', value: 'rgba(193, 76, 138, 0.28)' },
  { label: '红色', value: 'rgba(212, 76, 71, 0.28)' },
]

function shouldShowToolbar({
  editor,
  state,
}: {
  editor: Editor
  state: EditorState
}): boolean {
  if (!editor.isEditable || state.selection.empty) return false
  if (
    !(state.selection instanceof TextSelection) &&
    !(state.selection instanceof AllSelection)
  ) {
    return false
  }
  return state.selection.$from.parent.type.name !== 'codeBlock'
}

interface ColorSwatch {
  label: string
  value: string
}

interface ColorSectionProps {
  title: string
  label: string
  colors: ColorSwatch[]
  active: string | null
  kind: 'text' | 'background'
  fallback: string
  onApply: (value: string | null, close?: boolean) => void
}

interface ColorPanelProps {
  editor: Editor
  panelRef: RefObject<HTMLDivElement | null>
  position: { left: number; top: number }
  onClose: () => void
}

function toColorInput(value: string | null, fallback: string): string {
  if (value && /^#[0-9a-f]{6}$/i.test(value)) return value
  return fallback
}

function sameColor(current: string | null, target: string): boolean {
  return Boolean(current) && current?.toLowerCase() === target.toLowerCase()
}

function preventMouseDown(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault()
}

function ColorSection({
  title,
  label,
  colors,
  active,
  kind,
  fallback,
  onApply,
}: ColorSectionProps) {
  return (
    <div className="color-section">
      <div className="color-section-title">{title}</div>
      <div className="color-grid">
        <button
          type="button"
          className={`color-swatch no-color${active ? '' : ' is-active'}`}
          title={`无${label}`}
          aria-label={`无${label}`}
          onMouseDown={preventMouseDown}
          onClick={() => onApply(null)}
        >
          <Ban size={15} />
        </button>

        {colors.map((color) => (
          <button
            key={color.value}
            type="button"
            className={`color-swatch ${kind}-color${
              sameColor(active, color.value) ? ' is-active' : ''
            }`}
            style={kind === 'text' ? { color: color.value } : { background: color.value }}
            title={`${label}：${color.label}`}
            aria-label={`${label}：${color.label}`}
            onMouseDown={preventMouseDown}
            onClick={() => onApply(color.value)}
          >
            {kind === 'text' && <span>A</span>}
          </button>
        ))}

        <label className="color-swatch color-custom" title={`自定义${label}`}>
          <Palette size={15} />
          <input
            type="color"
            defaultValue={toColorInput(active, fallback)}
            aria-label={`自定义${label}`}
            onChange={(event) => onApply(event.target.value, false)}
          />
        </label>
      </div>
    </div>
  )
}

function ColorPanel({ editor, panelRef, position, onClose }: ColorPanelProps) {
  const attributes = editor.getAttributes('textStyle')
  const activeTextColor = typeof attributes.color === 'string' ? attributes.color : null
  const activeBackgroundColor =
    typeof attributes.backgroundColor === 'string' ? attributes.backgroundColor : null

  const applyTextColor = (color: string | null, close = true) => {
    if (color) editor.chain().setColor(color).run()
    else editor.chain().unsetColor().run()

    if (close) {
      editor.commands.focus()
      onClose()
    }
  }

  const applyBackgroundColor = (color: string | null, close = true) => {
    if (color) editor.chain().setBackgroundColor(color).run()
    else editor.chain().unsetBackgroundColor().run()

    if (close) {
      editor.commands.focus()
      onClose()
    }
  }

  return createPortal(
    <div
      ref={panelRef}
      className="selection-color-panel"
      style={{ left: position.left, top: position.top }}
      role="group"
      aria-label="文字颜色与背景色"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <ColorSection
        title="Text Color"
        label="文字颜色"
        colors={TEXT_COLORS}
        active={activeTextColor}
        kind="text"
        fallback={TEXT_COLORS[0].value}
        onApply={applyTextColor}
      />
      <ColorSection
        title="Background Color"
        label="背景颜色"
        colors={BACKGROUND_COLORS}
        active={activeBackgroundColor}
        kind="background"
        fallback="#808080"
        onApply={applyBackgroundColor}
      />
    </div>,
    document.body,
  )
}

export function SelectionToolbar({ editor }: { editor: Editor | null }) {
  const [colorOpen, setColorOpen] = useState(false)
  const [colorPosition, setColorPosition] = useState({ left: 8, top: 8 })
  const [linkDraft, setLinkDraft] = useState<LinkRange | null>(null)
  const colorButtonRef = useRef<HTMLButtonElement>(null)
  const colorPanelRef = useRef<HTMLDivElement>(null)

  const snapshot = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      underline: current?.isActive('underline') ?? false,
      link: current?.isActive('link') ?? false,
    }),
  }) ?? {
    bold: false,
    italic: false,
    underline: false,
    link: false,
  }

  useDismissPopover(colorOpen, colorPanelRef, colorButtonRef, () => setColorOpen(false))

  useEffect(() => {
    if (!editor || !colorOpen) return
    const close = () => setColorOpen(false)
    editor.on('selectionUpdate', close)
    return () => {
      editor.off('selectionUpdate', close)
    }
  }, [editor, colorOpen])

  const toggleColorPanel = () => {
    if (colorOpen) {
      setColorOpen(false)
      return
    }

    const button = colorButtonRef.current
    if (!button) return

    setColorPosition(
      placePanel(button.getBoundingClientRect(), {
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
      }),
    )
    setColorOpen(true)
  }

  const openLinkDialog = () => {
    if (!editor) return

    const selection = editor.state.selection
    if (!(selection instanceof TextSelection) || selection.empty) return

    if (!selection.$from.sameParent(selection.$to)) {
      useUiStore.getState().showToast('请选择同一段落内的文字添加链接', 'info')
      return
    }

    const draft = getSelectionLinkRange(editor)
    if (!draft) return

    setColorOpen(false)
    setLinkDraft(draft)
  }

  const saveLinkDraft = (url: string, title: string) => {
    if (!editor || !linkDraft) return
    applyLink(editor, linkDraft, url, title)
    setLinkDraft(null)
  }

  const removeLinkDraft = () => {
    if (!editor || !linkDraft) return
    removeLink(editor, linkDraft)
    setLinkDraft(null)
  }

  const cancelLinkDraft = () => {
    setLinkDraft(null)
    editor?.commands.focus()
  }

  if (!editor) return null

  return (
    <>
      <BubbleMenu
        editor={editor}
        updateDelay={100}
        appendTo={appendBubbleTo}
        shouldShow={shouldShowToolbar}
        options={BUBBLE_OPTIONS}
        className="selection-toolbar"
      >
        <button
          type="button"
          className={`selection-toolbar-button${snapshot.bold ? ' is-active' : ''}`}
          title="加粗"
          aria-label="加粗"
          aria-pressed={snapshot.bold}
          onMouseDown={preventMouseDown}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={15} />
        </button>

        <button
          type="button"
          className={`selection-toolbar-button${snapshot.italic ? ' is-active' : ''}`}
          title="斜体"
          aria-label="斜体"
          aria-pressed={snapshot.italic}
          onMouseDown={preventMouseDown}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={15} />
        </button>

        <button
          type="button"
          className={`selection-toolbar-button${snapshot.underline ? ' is-active' : ''}`}
          title="下划线"
          aria-label="下划线"
          aria-pressed={snapshot.underline}
          onMouseDown={preventMouseDown}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline size={15} />
        </button>

        <span className="selection-toolbar-divider" aria-hidden="true" />

        <button
          type="button"
          className={`selection-toolbar-button${snapshot.link ? ' is-active' : ''}`}
          title="链接"
          aria-label="链接"
          aria-pressed={snapshot.link}
          onMouseDown={preventMouseDown}
          onClick={openLinkDialog}
        >
          <Link2 size={15} />
        </button>

        <span className="selection-toolbar-divider" aria-hidden="true" />

        <button
          ref={colorButtonRef}
          type="button"
          className={`selection-toolbar-button selection-color-button${
            colorOpen ? ' is-active' : ''
          }`}
          title="文字颜色与背景色"
          aria-label="着色"
          aria-expanded={colorOpen}
          onMouseDown={preventMouseDown}
          onClick={toggleColorPanel}
        >
          <Palette size={15} />
          <ChevronDown size={10} />
        </button>
      </BubbleMenu>

      {colorOpen && (
        <ColorPanel
          editor={editor}
          panelRef={colorPanelRef}
          position={colorPosition}
          onClose={() => setColorOpen(false)}
        />
      )}

      {linkDraft && (
        <LinkEditorDialog
          link={linkDraft}
          onSave={saveLinkDraft}
          onRemove={removeLinkDraft}
          onCancel={cancelLinkDraft}
        />
      )}
    </>
  )
}
