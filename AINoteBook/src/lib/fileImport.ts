import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { marked } from 'marked'
import { useNoteStore } from '../store/useNoteStore'
import type { TreeNode } from '../types'
import { createEditorExtensions } from './editorExtensions'

export type ImportKind = 'md' | 'docx'

export interface ImportDocumentOptions {
  activate?: boolean
}

export function markdownToDocJson(text: string): JSONContent {
  return htmlToDocJson(marked.parse(text, { async: false }))
}

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

async function docxToHtml(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
  return result.value
}

export async function importDocument(
  file: File,
  kind: ImportKind,
  { activate = true }: ImportDocumentOptions = {},
): Promise<TreeNode> {
  let content: JSONContent

  if (kind === 'md') {
    const text = await file.text()
    if (!text.trim()) throw new Error('文件内容为空')
    content = markdownToDocJson(text)
  } else {
    const html = await docxToHtml(file)
    if (!html.trim()) throw new Error('文件内容为空')
    content = htmlToDocJson(html)
  }

  const name = file.name.replace(/\.[^.]+$/, '').trim() || '导入的文档'
  const { activeId, nodes, createNode } = useNoteStore.getState()
  const active = nodes.find((node) => node.id === activeId)
  const id = createNode({
    area: active?.area ?? 'space',
    parentId: active ? active.parentId : null,
    kind: 'doc',
    name,
    content,
    activate,
  })

  const created = useNoteStore.getState().nodes.find((node) => node.id === id)
  if (!created) throw new Error('创建文档失败')
  return created
}
