import type { NodeLocation, TreeNode } from '../types'
import { isAncestor } from './tree'
import type { TreeIndex } from './treeIndex'

export type MoveResult = 'ok' | 'invalid' | 'conflict'

export type MoveTarget = NodeLocation

export interface MoveOptions {
  /** 内部归档（把嵌入文档放入自己的附件文件夹）时允许附件文件夹作为目标 */
  allowAttachmentTarget?: boolean
}

let draggedNodeId: string | null = null

export function setDraggedNodeId(id: string | null): void {
  draggedNodeId = id
}

export function getDraggedNodeId(): string | null {
  return draggedNodeId
}

/** 只有带 ownerDocId 的文件夹才是附件文件夹 */
export function isAttachmentFolder(node: TreeNode): boolean {
  return node.kind === 'folder' && Boolean(node.ownerDocId)
}

/** 节点是否位于某个附件文件夹内部，复杂度 O(深度) */
export function isEmbeddedNode(index: TreeIndex, node: TreeNode): boolean {
  let parentId = node.parentId
  let guard = 0

  while (parentId && guard < 100) {
    const parent = index.byId.get(parentId)
    if (!parent) return false
    if (isAttachmentFolder(parent)) return true
    parentId = parent.parentId
    guard += 1
  }

  return false
}

export function findAttachmentFolder(
  index: TreeIndex,
  doc: TreeNode,
): TreeNode | undefined {
  if (doc.kind !== 'doc' || !doc.attachmentFolderId) return undefined
  const folder = index.byId.get(doc.attachmentFolderId)
  return folder?.kind === 'folder' && !folder.deletedAt ? folder : undefined
}

export function canDragNode(index: TreeIndex, node: TreeNode): boolean {
  if (node.deletedAt || isAttachmentFolder(node)) return false
  return !isEmbeddedNode(index, node)
}

export function canDropOnFolder(
  index: TreeIndex,
  dragId: string | null,
  targetId: string,
): boolean {
  if (!dragId) return false

  const drag = index.byId.get(dragId)
  const target = index.byId.get(targetId)
  if (!drag || !target || target.deletedAt || target.kind !== 'folder') return false
  if (!canDragNode(index, drag)) return false
  if (isAttachmentFolder(target) || isEmbeddedNode(index, target)) return false
  if (target.id === drag.id) return false
  if (drag.kind === 'folder' && isAncestor(index, drag.id, target.id)) return false

  return true
}

export function canDropOnArea(index: TreeIndex, dragId: string | null): boolean {
  if (!dragId) return false
  const drag = index.byId.get(dragId)
  return Boolean(drag && !drag.deletedAt && canDragNode(index, drag))
}
