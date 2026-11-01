import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { marked } from 'marked'
import { useNoteStore } from '../store/useNoteStore'
import { createEditorExtensions } from './editorExtensions'

export type ImportKind = 'md' | 'docx'

function htmlToDocJson(html: string): JSONContent {
  const element = document.createElement('div')
  const editor = new Editor({
    element,
    extensions: createEditorExtensions(),
    content: html,
    editable: false,
  })
  const json = editor.getJSON()
  editor.destroy()
  return json
}

async function fileToHtml(file: File, kind: ImportKind): Promise<string> {
  if (kind === 'md') {
    const text = await file.text()
    return marked.parse(text)
  }

  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
  return result.value
}

export async function importDocument(file: File, kind: ImportKind): Promise<{ id: string; name: string }> {
  const html = await fileToHtml(file, kind)
  if (!html.trim()) throw new Error('文件内容为空')

  const content = htmlToDocJson(html)
  const name = file.name.replace(/\.[^.]+$/, '').trim() || '导入的文档'

  const { activeId, nodes, createNode } = useNoteStore.getState()
  const active = nodes.find((node) => node.id === activeId)
  const id = createNode({
    area: active?.area ?? 'space',
    parentId: active ? active.parentId : null,
    kind: 'doc',
    name,
    content,
  })

  return { id, name }
}
