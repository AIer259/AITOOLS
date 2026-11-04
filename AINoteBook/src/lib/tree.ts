import { AREA_LABEL, type Area, type TreeNode } from '../types'
import type { TreeIndex } from './treeIndex'

export function getNode(index: TreeIndex, id: string | null): TreeNode | undefined {
  return id ? index.byId.get(id) : undefined
}

export function findFolder(
  index: TreeIndex,
  area: Area,
  parentId: string | null,
  name: string,
): TreeNode | undefined {
  return (index.activeChildren.get(parentId) ?? []).find(
    (node) => node.kind === 'folder' && node.area === area && node.name === name,
  )
}

/** 从根到当前节点的路径（含当前节点） */
export function getPath(index: TreeIndex, id: string | null): TreeNode[] {
  const path: TreeNode[] = []
  let current = getNode(index, id)
  let guard = 0
  while (current && guard < 100) {
    path.unshift(current)
    current = getNode(index, current.parentId)
    guard += 1
  }
  return path
}

/** 区域 + 父级文件夹路径，不含文档自身 */
export function formatNodePath(index: TreeIndex, node: TreeNode): string {
  const parents = node.parentId ? getPath(index, node.parentId) : []
  return [AREA_LABEL[node.area], ...parents.map((item) => item.name || '未命名')].join(
    ' / ',
  )
}

/** 子树 id 集合（含自身），复杂度 O(子树大小) */
export function getDescendantIds(index: TreeIndex, id: string): Set<string> {
  const ids = new Set<string>([id])
  const stack = [id]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    for (const child of index.children.get(current) ?? []) {
      if (ids.has(child.id)) continue
      ids.add(child.id)
      stack.push(child.id)
    }
  }

  return ids
}

/** ancestorId 是否为 nodeId 的祖先，复杂度 O(深度) */
export function isAncestor(
  index: TreeIndex,
  ancestorId: string,
  nodeId: string,
): boolean {
  let current = index.byId.get(nodeId)
  let guard = 0

  while (current?.parentId && guard < 100) {
    if (current.parentId === ancestorId) return true
    current = index.byId.get(current.parentId)
    guard += 1
  }

  return false
}

export function firstDoc(index: TreeIndex): TreeNode | undefined {
  return index.activeDocs[0]
}
