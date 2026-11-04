import type { Area, TreeNode } from '../types'
import { compareOrder } from './fractionalIndex'

const AREAS: Area[] = ['space', 'private']

/**
 * 从扁平节点数组派生的只读索引。
 * 只在 nodes 引用变化时重建；索引本身不持久化，也不被修改。
 */
export interface TreeIndex {
  readonly nodes: readonly TreeNode[]
  readonly byId: ReadonlyMap<string, TreeNode>
  /** 所有子节点（含回收站），按 order 排序 */
  readonly children: ReadonlyMap<string | null, readonly TreeNode[]>
  /** 活动子节点（不含回收站），按 order 排序 */
  readonly activeChildren: ReadonlyMap<string | null, readonly TreeNode[]>
  /** 各分区的活动根节点 */
  readonly roots: ReadonlyMap<Area, readonly TreeNode[]>
  /** 活动文档 */
  readonly activeDocs: readonly TreeNode[]
  /** 附件文件夹 id -> 引用它的活动文档 */
  readonly attachmentUsers: ReadonlyMap<string, readonly TreeNode[]>
  readonly trashedIds: ReadonlySet<string>
  /** 回收站根项，按删除时间倒序 */
  readonly trashRoots: readonly TreeNode[]
}

export function buildTreeIndex(nodes: readonly TreeNode[]): TreeIndex {
  const byId = new Map<string, TreeNode>()
  const buckets = new Map<string | null, TreeNode[]>()
  const activeDocs: TreeNode[] = []
  const attachmentUsers = new Map<string, TreeNode[]>()
  const trashedIds = new Set<string>()

  for (const node of nodes) {
    byId.set(node.id, node)

    const bucket = buckets.get(node.parentId)
    if (bucket) bucket.push(node)
    else buckets.set(node.parentId, [node])

    if (node.kind === 'doc') {
      if (!node.deletedAt) activeDocs.push(node)
      if (node.attachmentFolderId && !node.deletedAt) {
        const users = attachmentUsers.get(node.attachmentFolderId)
        if (users) users.push(node)
        else attachmentUsers.set(node.attachmentFolderId, [node])
      }
    }

    if (node.deletedAt) trashedIds.add(node.id)
  }

  const children = new Map<string | null, readonly TreeNode[]>()
  const activeChildren = new Map<string | null, readonly TreeNode[]>()
  for (const [parentId, bucket] of buckets) {
    bucket.sort((a, b) => compareOrder(a.order, b.order))
    children.set(parentId, bucket)
    activeChildren.set(
      parentId,
      bucket.filter((node) => !node.deletedAt),
    )
  }

  const activeRoots = activeChildren.get(null) ?? []
  const roots = new Map<Area, readonly TreeNode[]>()
  for (const area of AREAS) {
    roots.set(
      area,
      activeRoots.filter((node) => node.area === area),
    )
  }

  const trashRoots = nodes
    .filter((node) => {
      if (!node.deletedAt) return false

      if (node.parentId) {
        const parent = byId.get(node.parentId)
        if (parent?.deletedAt) return false
      }

      if (node.kind === 'folder' && node.ownerDocId) {
        const owner = byId.get(node.ownerDocId)
        if (owner?.deletedAt) return false
      }

      return true
    })
    .sort((a, b) => {
      const diff = (b.deletedAt ?? 0) - (a.deletedAt ?? 0)
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-CN')
    })

  return {
    nodes,
    byId,
    children,
    activeChildren,
    roots,
    activeDocs,
    attachmentUsers,
    trashedIds,
    trashRoots,
  }
}

const indexCache = new WeakMap<readonly TreeNode[], TreeIndex>()

/** 按 nodes 数组引用缓存，保证同一份状态只构建一次 */
export function getTreeIndex(nodes: readonly TreeNode[]): TreeIndex {
  const cached = indexCache.get(nodes)
  if (cached) return cached

  const index = buildTreeIndex(nodes)
  indexCache.set(nodes, index)
  return index
}
