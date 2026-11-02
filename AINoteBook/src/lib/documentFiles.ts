import type { Editor } from '@tiptap/core'
import { getActiveLocation, useNoteStore } from '../store/useNoteStore'
import {
  DOC_TYPE_LABEL,
  type DocType,
  type NodeLocation,
  type TreeNode,
} from '../types'
import { placeEmbeddedDoc } from './attachments'
import { createBlobId, saveBlob } from './db'

type DocumentUploadType = Exclude<DocType, 'md'>

export async function uploadDocumentFile(
  file: File,
  docType: DocumentUploadType,
  target?: NodeLocation,
): Promise<TreeNode> {
  const blobId = createBlobId()
  await saveBlob(blobId, await file.arrayBuffer())

  const name = file.name.replace(/\.[^.]+$/, '').trim() || `${DOC_TYPE_LABEL[docType]} 文档`

  const { createNode } = useNoteStore.getState()
  const location = target ?? getActiveLocation()
  const id = createNode({
    area: location.area,
    parentId: location.parentId,
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

  const { activeId, nodes } = useNoteStore.getState()
  const active = nodes.find((node) => node.id === activeId)
  const target = active ? placeEmbeddedDoc(active, doc) : doc

  const safePos = Math.min(Math.max(pos, 0), editor.state.doc.content.size)
  const $pos = editor.state.doc.resolve(safePos)
  const block = $pos.parent
  const embed = nodeType
    .create({ docId: target.id, name: target.name, docType: target.docType ?? 'md' })
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
