import type { TreeNode } from '../types'
import { compareOrder } from './fractionalIndex'

export function getNode(nodes: TreeNode[], id: string | null): TreeNode | undefined {
  if (!id) return undefined
  return nodes.find((node) => node.id === id)
}

export function getChildren(
  nodes: TreeNode[],
  parentId: string | null,
  area?: TreeNode['area'],
): TreeNode[] {
  return nodes
    .filter((node) => node.parentId === parentId && (!area || node.area === area))
    .sort((a, b) => compareOrder(a.order, b.order))
}

export function findFolder(
  nodes: TreeNode[],
  area: TreeNode['area'],
  parentId: string | null,
  name: string,
): TreeNode | undefined {
  return nodes.find(
    (node) =>
      node.kind === 'folder' &&
      node.area === area &&
      node.parentId === parentId &&
      node.name === name,
  )
}

/** 从根到当前节点的路径（含当前节点） */
export function getPath(nodes: TreeNode[], id: string | null): TreeNode[] {
  const path: TreeNode[] = []
  let current = getNode(nodes, id)
  let guard = 0
  while (current && guard < 100) {
    path.unshift(current)
    current = getNode(nodes, current.parentId)
    guard += 1
  }
  return path
}

export function getDescendantIds(nodes: TreeNode[], id: string): Set<string> {
  const ids = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id)
        changed = true
      }
    }
  }
  return ids
}

export function firstDoc(nodes: TreeNode[]): TreeNode | undefined {
  return nodes.find((node) => node.kind === 'doc')
}
