import type { NodeLocation, TreeNode } from '../types'
import {
  attachmentFolderName,
  collectEmbeddedDocIds,
  isAttachmentFolderName,
} from './embedRefs'
import { getDescendantIds } from './tree'

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

/** 名字匹配且同级存在对应主文档，才算附件文件夹 */
export function isAttachmentFolder(nodes: TreeNode[], node: TreeNode): boolean {
  if (node.kind !== 'folder' || !isAttachmentFolderName(node.name)) return false

  return nodes.some(
    (item) =>
      item.kind === 'doc' &&
      item.area === node.area &&
      item.parentId === node.parentId &&
      attachmentFolderName(item.name) === node.name,
  )
}

/** 节点是否位于某个附件文件夹内部 */
export function isEmbeddedNode(nodes: TreeNode[], node: TreeNode): boolean {
  let parentId = node.parentId
  let guard = 0

  while (parentId && guard < 100) {
    const parent = nodes.find((item) => item.id === parentId)
    if (!parent) return false
    if (isAttachmentFolder(nodes, parent)) return true
    parentId = parent.parentId
    guard += 1
  }

  return false
}

export function findAttachmentFolder(
  nodes: TreeNode[],
  doc: TreeNode,
): TreeNode | undefined {
  if (doc.kind !== 'doc') return undefined

  return nodes.find(
    (node) =>
      node.kind === 'folder' &&
      node.area === doc.area &&
      node.parentId === doc.parentId &&
      node.name === attachmentFolderName(doc.name),
  )
}

/** 尚未迁入附件文件夹、仍与主文件平级的嵌入文档 */
export function findFlatEmbeddedDocs(
  nodes: TreeNode[],
  doc: TreeNode,
): TreeNode[] {
  if (doc.kind !== 'doc') return []

  return collectEmbeddedDocIds(doc.content)
    .map((id) => nodes.find((node) => node.id === id))
    .filter(
      (node): node is TreeNode =>
        Boolean(
          node &&
            node.id !== doc.id &&
            node.kind === 'doc' &&
            node.area === doc.area &&
            node.parentId === doc.parentId,
        ),
    )
}

export function canDragNode(nodes: TreeNode[], node: TreeNode): boolean {
  if (isAttachmentFolder(nodes, node)) return false
  return !isEmbeddedNode(nodes, node)
}

export function canDropOnFolder(
  nodes: TreeNode[],
  dragId: string | null,
  targetId: string,
): boolean {
  if (!dragId) return false

  const drag = nodes.find((node) => node.id === dragId)
  const target = nodes.find((node) => node.id === targetId)
  if (!drag || !target || target.kind !== 'folder') return false
  if (!canDragNode(nodes, drag)) return false
  if (isAttachmentFolder(nodes, target) || isEmbeddedNode(nodes, target)) return false
  if (target.id === drag.id) return false
  if (drag.kind === 'folder' && getDescendantIds(nodes, drag.id).has(target.id)) {
    return false
  }

  return true
}

export function canDropOnArea(nodes: TreeNode[], dragId: string | null): boolean {
  if (!dragId) return false
  const drag = nodes.find((node) => node.id === dragId)
  return Boolean(drag && canDragNode(nodes, drag))
}
