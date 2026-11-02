import type { Editor } from '@tiptap/core'
import { useNoteStore } from '../store/useNoteStore'
import { DOC_TYPE_LABEL, type DocType, type TreeNode } from '../types'
import { saveBlob } from './db'

type DocumentUploadType = Exclude<DocType, 'md'>

function makeBlobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `blob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function uploadDocumentFile(
  file: File,
  docType: DocumentUploadType,
): Promise<TreeNode> {
  const blobId = makeBlobId()
  await saveBlob(blobId, await file.arrayBuffer())

  const name = file.name.replace(/\.[^.]+$/, '').trim() || `${DOC_TYPE_LABEL[docType]} 文档`

  const { activeId, nodes, createNode } = useNoteStore.getState()
  const active = nodes.find((node) => node.id === activeId)
  const id = createNode({
    area: active?.area ?? 'space',
    parentId: active ? active.parentId : null,
    kind: 'doc',
    name,
    docType,
    blobId,
    activate: false,
  })

  const created = useNoteStore.getState().nodes.find((node) => node.id === id)
  if (!created) throw new Error('创建文件记录失败')
  return created
}

export function insertDocumentEmbed(editor: Editor, pos: number, doc: TreeNode): void {
  const nodeType = editor.schema.nodes.documentEmbed
  if (!nodeType) return

  const safePos = Math.min(Math.max(pos, 0), editor.state.doc.content.size)
  const $pos = editor.state.doc.resolve(safePos)
  const block = $pos.parent
  const embed = nodeType
    .create({ docId: doc.id, name: doc.name, docType: doc.docType ?? 'md' })
    .toJSON()
  const trailingParagraph = { type: 'paragraph' }

  if (block.isTextblock && block.textContent.trim() === '' && $pos.depth > 0) {
    const from = $pos.before($pos.depth)
    const to = $pos.after($pos.depth)
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContentAt(from, [embed, trailingParagraph])
      .run()
    return
  }

  editor.chain().focus().insertContentAt(safePos, [embed, trailingParagraph]).run()
}
