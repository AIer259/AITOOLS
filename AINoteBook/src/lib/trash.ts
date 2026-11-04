import type { TreeNode } from '../types'
import { formatNodePath, getDescendantIds } from './tree'
import type { TreeIndex } from './treeIndex'

export interface TrashBundleSummary {
  ids: Set<string>
  docs: number
  folders: number
  attachmentFolder?: TreeNode
}

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** 附件文件夹是否仍被其他活动文档引用（此时不能随主文档删除） */
export function isSharedAttachmentFolder(
  index: TreeIndex,
  folderId: string,
  ownerId: string,
): boolean {
  return (index.attachmentUsers.get(folderId) ?? []).some(
    (doc) => doc.id !== ownerId,
  )
}

/** 回收站整包：根节点自身子树 + 主文档显式关联的附件文件夹 */
export function getTrashBundleIds(index: TreeIndex, root: TreeNode): Set<string> {
  const ids = getDescendantIds(index, root.id)
  if (root.kind === 'doc' && root.attachmentFolderId) {
    const folder = index.byId.get(root.attachmentFolderId)
    if (folder?.deletedAt) {
      for (const id of getDescendantIds(index, folder.id)) ids.add(id)
    }
  }
  return ids
}

/** 从任意被删节点回溯到所属回收站根项（附件文件夹会回溯到主文档） */
export function getTrashRoot(
  index: TreeIndex,
  id: string,
): TreeNode | undefined {
  const found = index.byId.get(id)
  if (!found?.deletedAt) return undefined

  let node = found
  if (node.kind === 'folder' && node.ownerDocId) {
    const owner = index.byId.get(node.ownerDocId)
    if (owner?.deletedAt) node = owner
  }

  let guard = 0
  while (node.parentId && guard < 100) {
    const parent = index.byId.get(node.parentId)
    if (!parent?.deletedAt) break
    node = parent
    guard += 1
  }

  return node
}

export function summarizeTrash(
  index: TreeIndex,
  root: TreeNode,
): TrashBundleSummary {
  const ids = getTrashBundleIds(index, root)
  let docs = 0
  let folders = 0

  for (const id of ids) {
    const node = index.byId.get(id)
    if (!node) continue
    if (node.kind === 'doc') docs += 1
    else folders += 1
  }

  const attachmentFolder =
    root.kind === 'doc' && root.attachmentFolderId
      ? index.byId.get(root.attachmentFolderId)
      : undefined

  return {
    ids,
    docs,
    folders,
    attachmentFolder:
      attachmentFolder?.kind === 'folder' && attachmentFolder.deletedAt
        ? attachmentFolder
        : undefined,
  }
}

export function getTrashLocation(index: TreeIndex, node: TreeNode): string {
  return formatNodePath(index, node)
}

export function formatTrashTime(timestamp: number | undefined): string {
  return timestamp ? timeFormatter.format(timestamp) : ''
}
