import type { Editor } from '@tiptap/core'
import type { TreeNode } from '../types'

/** 在指定位置插入嵌入卡片；调用方负责先把 doc 放入主笔记的附件文件夹 */
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
