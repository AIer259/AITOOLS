import { useNoteStore } from '../store/useNoteStore'
import type { NodeLocation, TreeNode } from '../types'
import { attachmentFolderName } from './embedRefs'
import { findFolder } from './tree'
import { findFlatEmbeddedDocs } from './treeDrag'

/** 按区域/父目录/名称查找文件夹，不存在则创建（附件文件夹默认折叠） */
export function ensureFolder(location: NodeLocation, name: string): string {
  const state = useNoteStore.getState()
  const existing = findFolder(state.nodes, location.area, location.parentId, name)
  if (existing) return existing.id

  return state.createNode({
    area: location.area,
    parentId: location.parentId,
    kind: 'folder',
    name,
    expanded: false,
  })
}

/** 确保主笔记的附件文件夹存在，与主笔记同区域、同父目录 */
export function ensureAttachmentFolder(note: TreeNode): TreeNode {
  const id = ensureFolder(
    { area: note.area, parentId: note.parentId },
    attachmentFolderName(note.name),
  )
  const folder = useNoteStore.getState().nodes.find((node) => node.id === id)
  if (!folder) throw new Error('创建附件文件夹失败')
  return folder
}

/** 把被嵌入的文档移入主笔记的附件文件夹 */
export function placeEmbeddedDoc(note: TreeNode, doc: TreeNode): TreeNode {
  if (doc.kind !== 'doc') return doc

  const folder = ensureAttachmentFolder(note)
  if (doc.parentId === folder.id) return doc

  useNoteStore
    .getState()
    .moveNodeTo(
      doc.id,
      { area: folder.area, parentId: folder.id },
      { allowAttachmentTarget: true },
    )
  return useNoteStore.getState().nodes.find((node) => node.id === doc.id) ?? doc
}

/** 打开笔记时，把仍与主文件平级的嵌入文档移入附件文件夹（不搬动其他目录的文档） */
export function migrateFlatEmbeds(noteId: string): void {
  const state = useNoteStore.getState()
  const note = state.nodes.find((node) => node.id === noteId)
  if (!note?.content) return

  const flatDocs = findFlatEmbeddedDocs(state.nodes, note)
  if (flatDocs.length === 0) return

  const folder = ensureAttachmentFolder(note)
  for (const doc of flatDocs) {
    if (doc.parentId !== folder.id) {
      useNoteStore
        .getState()
        .moveNodeTo(
          doc.id,
          { area: folder.area, parentId: folder.id },
          { allowAttachmentTarget: true },
        )
    }
  }
}
