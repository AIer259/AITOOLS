import type { JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import {
  useEffect,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type MouseEvent,
} from 'react'
import { createEditorExtensions } from '../../lib/editorExtensions'
import { collectImageFiles, saveImageAsset } from '../../lib/imageAssets'
import { getTreeIndex } from '../../lib/treeIndex'
import { useNoteStore } from '../../store/useNoteStore'
import { useUiStore } from '../../store/useUiStore'
import type { TreeNode } from '../../types'
import { LinkTools } from './LinkTools'
import { SelectionToolbar } from './SelectionToolbar'

interface NoteEditorProps {
  node: TreeNode
}

const EMPTY_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

export function NoteEditor({ node }: NoteEditorProps) {
  const renameNode = useNoteStore((state) => state.renameNode)
  const updateContent = useNoteStore((state) => state.updateContent)
  const readContent = useNoteStore((state) => state.readContent)
  const setEditor = useUiStore((state) => state.setEditor)
  const setContentReadyId = useUiStore((state) => state.setContentReadyId)
  const [contentReady, setContentReady] = useState(false)

  const editor = useEditor({
    extensions: createEditorExtensions(),
    content: EMPTY_DOC,
    editorProps: {
      attributes: {
        class: 'note-prose',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor: current }) => {
      updateContent(node.id, current.getJSON())
    },
  })

  useEffect(() => {
    let cancelled = false
    setContentReady(false)
    setContentReadyId(null)

    readContent(node.id)
      .then((content) => {
        if (cancelled) return
        editor?.commands.setContent(content ?? EMPTY_DOC, { emitUpdate: false })
        setContentReady(true)
        setContentReadyId(node.id)
      })
      .catch((error) => {
        console.error('加载笔记内容失败', error)
        if (cancelled) return
        editor?.commands.setContent(EMPTY_DOC, { emitUpdate: false })
        setContentReady(true)
        setContentReadyId(node.id)
      })

    return () => {
      cancelled = true
      setContentReadyId(null)
    }
  }, [node.id, editor, readContent, setContentReadyId])

  useEffect(() => {
    if (!contentReady) return
    setEditor(editor ?? null)
    return () => setEditor(null)
  }, [editor, contentReady, setEditor])

  const appendParagraph = () => {
    if (!editor) return

    const doc = editor.state.doc
    const last = doc.lastChild

    // 末尾已有空块时直接聚焦，避免连续产生空行
    if (last && last.isTextblock && last.textContent.trim() === '') {
      editor.chain().focus('end').scrollIntoView().run()
      return
    }

    const end = doc.content.size
    const paragraph = editor.schema.nodes.paragraph.create()
    const transaction = editor.state.tr.insert(end, paragraph)
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(end + 1)))
    transaction.scrollIntoView()
    editor.view.dispatch(transaction)
    editor.view.focus()
  }

  const handleBlankMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !contentReady) return
    const target = event.target as HTMLElement
    if (target.closest('.ProseMirror')) return

    // Portal 菜单的点击经 React 冒泡到这里，但目标不在正文滚动区内，不应当作点击空白
    const container = event.currentTarget
    if (!container.contains(target)) return

    // 点击滚动条轨道/滑块时不追加段落，交给浏览器原生滚动处理
    const rect = container.getBoundingClientRect()
    const scrollbarWidth = container.offsetWidth - container.clientWidth
    if (scrollbarWidth > 0 && event.clientX >= rect.right - scrollbarWidth) return

    event.preventDefault()
    appendParagraph()
  }

  const insertImages = async (files: File[], atPos: number) => {
    if (!editor || files.length === 0) return

    const active = getTreeIndex(useNoteStore.getState().nodes).byId.get(node.id)
    const noteName = active?.name || node.name || '未命名文档'

    try {
      const nodes: JSONContent[] = []
      for (const file of files) {
        const saved = await saveImageAsset(file, noteName)
        nodes.push({
          type: 'noteImage',
          attrs: {
            assetId: saved.meta.id,
            alt: file.name || '图片',
            path: saved.path,
          },
        })
      }

      const pos = Math.min(Math.max(atPos, 0), editor.state.doc.content.size)
      editor
        .chain()
        .focus()
        .insertContentAt(pos, [...nodes, { type: 'paragraph' }])
        .run()
      void useUiStore.getState().refreshStorage()
    } catch (error) {
      console.error(error)
      const message =
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? '存储空间不足，图片未保存'
          : '图片保存失败，请重试'
      useUiStore.getState().showToast(message, 'error')
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = collectImageFiles(event.clipboardData)
    if (files.length === 0 || !editor) return

    event.preventDefault()
    event.stopPropagation()
    void insertImages(files, editor.state.selection.from)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = collectImageFiles(event.dataTransfer)
    if (files.length === 0 || !editor) return

    event.preventDefault()
    event.stopPropagation()
    const dropPos =
      editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
      editor.state.selection.from
    void insertImages(files, dropPos)
  }

  return (
    <div className="editor-scroll note-shell">
      <article className="paper note-paper">
        <input
          className="note-title"
          value={node.name}
          placeholder="未命名文档"
          aria-label="笔记标题"
          onChange={(event) => renameNode(node.id, event.target.value)}
          onBlur={() => {
            if (!node.name.trim()) renameNode(node.id, '未命名文档')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              editor?.commands.focus('start')
            }
          }}
        />

        <div className="paper-meta">
          <span>Markdown 文档</span>
          <span className="meta-dot">·</span>
          <span>内容自动保存</span>
        </div>

        <div
          className="note-body-scroll"
          onMouseDown={handleBlankMouseDown}
          onPasteCapture={handlePaste}
          onDropCapture={handleDrop}
        >
          <div className="note-body-inner">
            {contentReady ? (
              <EditorContent editor={editor} />
            ) : (
              <div className="note-loading">正在加载笔记…</div>
            )}
            <div className="note-add-space" aria-hidden="true" />
          </div>
        </div>

        <SelectionToolbar editor={editor} />
        <LinkTools editor={editor} />
      </article>
    </div>
  )
}
