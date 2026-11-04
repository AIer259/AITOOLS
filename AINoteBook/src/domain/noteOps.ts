import type { JSONContent } from '@tiptap/core'
import type { Area, DocType, NodeKind, TreeNode } from '../types'
import { attachmentFolderName, isAttachmentFolderName } from '../lib/embedRefs'
import {
  compareOrder,
  generateKeyBetween,
  nextOrder,
} from '../lib/fractionalIndex'
import { findFolder, getDescendantIds } from '../lib/tree'
import { getTreeIndex, type TreeIndex } from '../lib/treeIndex'
import {
  getTrashBundleIds,
  getTrashRoot,
  isSharedAttachmentFolder,
} from '../lib/trash'
import {
  isAttachmentFolder,
  isEmbeddedNode,
  type MoveOptions,
  type MoveResult,
  type MoveTarget,
} from '../lib/treeDrag'

export interface CreateNodeInput {
  area: Area
  parentId: string | null
  kind: NodeKind
  name: string
  docType?: DocType
  content?: JSONContent
  blobId?: string
  activate?: boolean
  expanded?: boolean
  order?: string
}

export interface CreateNodePlan {
  nodes: TreeNode[]
  expanded: Record<string, boolean>
  node: TreeNode
  content?: JSONContent
}

export function planCreateNode(
  index: TreeIndex,
  expandedState: Record<string, boolean>,
  input: CreateNodeInput,
  id: string,
  now = Date.now(),
): CreateNodePlan {
  const fallback = input.kind === 'doc' ? '未命名文档' : '新建文件夹'
  const finalName = input.name.trim() || fallback
  const finalDocType = input.docType ?? 'md'
  const siblings = (index.children.get(input.parentId) ?? []).filter(
    (item) => item.area === input.area,
  )
  const order = input.order ?? nextOrder(siblings.map((item) => item.order))
  const node: TreeNode = {
    id,
    area: input.area,
    parentId: input.parentId,
    kind: input.kind,
    name: finalName,
    order,
    createdAt: now,
    updatedAt: now,
    ...(input.kind === 'doc'
      ? {
          docType: finalDocType,
          ...(input.blobId ? { blobId: input.blobId } : {}),
        }
      : {}),
  }

  const nextNodes = [...index.nodes, node]
  const expanded = { ...expandedState }
  const parentNode = input.parentId
    ? index.byId.get(input.parentId)
    : undefined
  if (
    input.parentId &&
    !parentNode?.ownerDocId &&
    !isAttachmentFolderName(parentNode?.name ?? '')
  ) {
    expanded[input.parentId] = true
  }
  if (input.kind === 'folder') expanded[id] = input.expanded ?? true

  return {
    nodes: nextNodes,
    expanded,
    node,
    content: input.kind === 'doc' && finalDocType === 'md' ? input.content : undefined,
  }
}

export interface MovePlan {
  result: MoveResult
  nodes: TreeNode[]
  expanded: Record<string, boolean>
}

export function planMoveNode(
  index: TreeIndex,
  expandedState: Record<string, boolean>,
  id: string,
  target: MoveTarget,
  options?: MoveOptions,
  now = Date.now(),
): MovePlan {
  const node = index.byId.get(id)
  if (!node) return { result: 'invalid', nodes: [...index.nodes], expanded: expandedState }

  const targetFolder = target.parentId
    ? index.byId.get(target.parentId)
    : undefined
  if (
    target.parentId &&
    (!targetFolder || targetFolder.kind !== 'folder' || Boolean(targetFolder.deletedAt))
  ) {
    return { result: 'invalid', nodes: [...index.nodes], expanded: expandedState }
  }
  if (isAttachmentFolder(node) || isEmbeddedNode(index, node)) {
    return { result: 'invalid', nodes: [...index.nodes], expanded: expandedState }
  }
  if (
    targetFolder &&
    !options?.allowAttachmentTarget &&
    (isAttachmentFolder(targetFolder) || isEmbeddedNode(index, targetFolder))
  ) {
    return { result: 'invalid', nodes: [...index.nodes], expanded: expandedState }
  }

  // 根节点集合：普通节点自身；主文档还包括显式关联的附件文件夹
  const rootIds = new Set<string>([id])
  if (node.kind === 'doc' && node.attachmentFolderId) {
    const folder = index.byId.get(node.attachmentFolderId)
    if (folder?.kind === 'folder') {
      const conflict = findFolder(index, target.area, target.parentId, folder.name)
      if (conflict && conflict.id !== folder.id) {
        return { result: 'conflict', nodes: [...index.nodes], expanded: expandedState }
      }
      rootIds.add(folder.id)
    }
  }

  const movingIds = new Set<string>()
  for (const rootId of rootIds) {
    for (const movingId of getDescendantIds(index, rootId)) movingIds.add(movingId)
  }

  if (node.kind === 'folder' && target.parentId && movingIds.has(target.parentId)) {
    return { result: 'invalid', nodes: [...index.nodes], expanded: expandedState }
  }

  // 换父级时把移动的根节点追加到目标目录末尾；保留已有顺序
  let orderCursor = ''
  for (const item of index.children.get(target.parentId) ?? []) {
    if (
      item.area === target.area &&
      !movingIds.has(item.id) &&
      compareOrder(item.order, orderCursor) > 0
    ) {
      orderCursor = item.order
    }
  }
  const nextOrders = new Map<string, string>()
  for (const rootId of rootIds) {
    const root = index.byId.get(rootId)
    if (!root) continue
    if (root.area === target.area && root.parentId === target.parentId) {
      nextOrders.set(rootId, root.order)
      continue
    }
    const order = generateKeyBetween(orderCursor || null, null)
    nextOrders.set(rootId, order)
    orderCursor = order
  }

  const nextNodes = index.nodes.map((item) => {
    if (!movingIds.has(item.id)) return item
    const root = rootIds.has(item.id)
    return {
      ...item,
      area: target.area,
      ...(root
        ? { parentId: target.parentId, order: nextOrders.get(item.id) ?? item.order }
        : {}),
      updatedAt: now,
    }
  })

  const expanded = { ...expandedState }
  if (target.parentId && !targetFolder?.ownerDocId) {
    expanded[target.parentId] = true
  }

  return { result: 'ok', nodes: nextNodes, expanded }
}

export interface TrashPlan {
  nodes: TreeNode[]
  trashedIds: Set<string>
  activeIdFallback: string | null
}

export function planTrashNode(
  index: TreeIndex,
  id: string,
  now = Date.now(),
): TrashPlan | null {
  const target = index.byId.get(id)
  if (!target || target.deletedAt) return null
  // 附件文件夹只能随主文档一起移入回收站
  if (isAttachmentFolder(target)) return null

  const ids = getDescendantIds(index, id)

  if (target.kind === 'doc' && target.attachmentFolderId) {
    const folder = index.byId.get(target.attachmentFolderId)
    const shared =
      folder && !folder.deletedAt
        ? isSharedAttachmentFolder(index, folder.id, target.id)
        : false

    if (folder && !shared) {
      for (const folderId of getDescendantIds(index, folder.id)) ids.add(folderId)
    }
  }

  const nextNodes = index.nodes.map((node) =>
    ids.has(node.id) ? { ...node, deletedAt: node.deletedAt ?? now } : node,
  )
  const activeIdFallback =
    index.activeDocs.find((doc) => !ids.has(doc.id))?.id ?? null

  return {
    nodes: nextNodes,
    trashedIds: ids,
    activeIdFallback,
  }
}

export interface RestorePlan {
  nodes: TreeNode[]
  expanded: Record<string, boolean>
  root: TreeNode
  reparented: boolean
}

function clearDeletedAt(node: TreeNode): TreeNode {
  const restored = { ...node }
  delete restored.deletedAt
  return restored
}

export function planRestoreNode(
  index: TreeIndex,
  id: string,
  expandedState: Record<string, boolean>,
  now = Date.now(),
): RestorePlan | null {
  const root = getTrashRoot(index, id)
  if (!root) return null

  const ids = getTrashBundleIds(index, root)
  const parent = root.parentId ? index.byId.get(root.parentId) : undefined
  const reparented = Boolean(root.parentId && (!parent || parent.deletedAt))
  const order = reparented
    ? nextOrder((index.roots.get(root.area) ?? []).map((node) => node.order))
    : root.order

  const nextNodes = index.nodes.map((node) => {
    if (!ids.has(node.id)) return node

    const restored = clearDeletedAt(node)
    const isRoot = node.id === root.id
    return {
      ...restored,
      ...(isRoot && reparented ? { parentId: null, order } : {}),
      ...(isRoot ? { updatedAt: now } : {}),
    }
  })

  const expanded = { ...expandedState }
  const parentId = reparented ? null : root.parentId
  if (parentId) expanded[parentId] = true
  if (root.kind === 'folder' && expanded[root.id] === undefined) {
    expanded[root.id] = true
  }

  return {
    nodes: nextNodes,
    expanded,
    root,
    reparented,
  }
}

export interface PurgePlan {
  remaining: TreeNode[]
  removed: TreeNode[]
  removedIds: Set<string>
  activeIdFallback: string | null
}

function detachPurgedFolders(nodes: readonly TreeNode[], removedIds: Set<string>): TreeNode[] {
  return nodes.map((node) => {
    if (
      node.kind === 'doc' &&
      node.attachmentFolderId &&
      removedIds.has(node.attachmentFolderId)
    ) {
      return { ...node, attachmentFolderId: undefined, updatedAt: Date.now() }
    }
    return node
  })
}

export function planPurgeNode(index: TreeIndex, id: string): PurgePlan | null {
  const target = index.byId.get(id)
  if (!target?.deletedAt) return null

  const root = getTrashRoot(index, id)
  if (!root || root.id !== target.id) return null

  const removedIds = getTrashBundleIds(index, target)
  const removed = index.nodes.filter((node) => removedIds.has(node.id))
  const remaining = detachPurgedFolders(
    index.nodes.filter((node) => !removedIds.has(node.id)),
    removedIds,
  )

  return {
    remaining,
    removed,
    removedIds,
    activeIdFallback:
      index.activeDocs.find((doc) => !removedIds.has(doc.id))?.id ?? null,
  }
}

export function planEmptyTrash(index: TreeIndex): PurgePlan {
  const removedIds = new Set(index.trashedIds)
  const removed = index.nodes.filter((node) => removedIds.has(node.id))
  const remaining = detachPurgedFolders(
    index.nodes.filter((node) => !removedIds.has(node.id)),
    removedIds,
  )

  return {
    remaining,
    removed,
    removedIds,
    activeIdFallback: index.activeDocs[0]?.id ?? null,
  }
}

export interface EnsureFolderPlan {
  nodes: TreeNode[]
  expanded: Record<string, boolean>
  folder: TreeNode
  created: TreeNode | null
}

export function planEnsureFolder(
  index: TreeIndex,
  expandedState: Record<string, boolean>,
  location: { area: Area; parentId: string | null },
  name: string,
  newFolderId: string,
  now = Date.now(),
): EnsureFolderPlan {
  const existing = findFolder(index, location.area, location.parentId, name)
  if (existing) {
    return { nodes: [...index.nodes], expanded: expandedState, folder: existing, created: null }
  }

  const plan = planCreateNode(
    index,
    expandedState,
    {
      area: location.area,
      parentId: location.parentId,
      kind: 'folder',
      name,
      expanded: false,
    },
    newFolderId,
    now,
  )
  return { ...plan, folder: plan.node, created: plan.node }
}

export type AttachmentFolderPlan = EnsureFolderPlan

function linkAttachmentFolder(
  nodes: TreeNode[],
  expandedState: Record<string, boolean>,
  note: TreeNode,
  folder: TreeNode,
  created: TreeNode | null,
  now: number,
): AttachmentFolderPlan {
  if (note.attachmentFolderId === folder.id && folder.ownerDocId === note.id) {
    return { nodes, expanded: expandedState, folder, created }
  }

  const next = nodes.map((node) => {
    if (node.id === note.id && node.kind === 'doc') {
      return { ...node, attachmentFolderId: folder.id, updatedAt: now }
    }
    if (node.id === folder.id && node.kind === 'folder') {
      return { ...node, ownerDocId: note.id, updatedAt: now }
    }
    return node
  })
  const updatedFolder = next.find((node) => node.id === folder.id) ?? folder

  return {
    nodes: next,
    expanded: expandedState,
    folder: updatedFolder,
    created: created ? updatedFolder : null,
  }
}

export function planAttachmentFolder(
  index: TreeIndex,
  expandedState: Record<string, boolean>,
  note: TreeNode,
  newFolderId: string,
  now = Date.now(),
): AttachmentFolderPlan {
  if (note.attachmentFolderId) {
    const linked = index.byId.get(note.attachmentFolderId)
    if (linked?.kind === 'folder' && !linked.deletedAt) {
      return linkAttachmentFolder(
        [...index.nodes],
        expandedState,
        note,
        linked,
        null,
        now,
      )
    }
  }

  // 兼容迁移前的旧数据：按名称与兄弟关系找回附件文件夹
  const legacy = findFolder(
    index,
    note.area,
    note.parentId,
    attachmentFolderName(note.name),
  )
  if (legacy) {
    return linkAttachmentFolder(
      [...index.nodes],
      expandedState,
      note,
      legacy,
      null,
      now,
    )
  }

  const plan = planEnsureFolder(
    index,
    expandedState,
    { area: note.area, parentId: note.parentId },
    attachmentFolderName(note.name),
    newFolderId,
    now,
  )
  return linkAttachmentFolder(
    plan.nodes,
    plan.expanded,
    note,
    plan.folder,
    plan.created,
    now,
  )
}

export interface PlaceEmbeddedDocPlan {
  nodes: TreeNode[]
  expanded: Record<string, boolean>
  doc: TreeNode
  folder: TreeNode | null
  moved: boolean
}

export function planPlaceEmbeddedDoc(
  index: TreeIndex,
  expandedState: Record<string, boolean>,
  note: TreeNode,
  doc: TreeNode,
  newFolderId: string,
  now = Date.now(),
): PlaceEmbeddedDocPlan {
  if (doc.kind !== 'doc') {
    return { nodes: [...index.nodes], expanded: expandedState, doc, folder: null, moved: false }
  }

  const folderPlan = planAttachmentFolder(index, expandedState, note, newFolderId, now)
  if (doc.parentId === folderPlan.folder.id) {
    return {
      nodes: folderPlan.nodes,
      expanded: folderPlan.expanded,
      doc,
      folder: folderPlan.folder,
      moved: false,
    }
  }

  const movePlan = planMoveNode(
    getTreeIndex(folderPlan.nodes),
    folderPlan.expanded,
    doc.id,
    { area: folderPlan.folder.area, parentId: folderPlan.folder.id },
    { allowAttachmentTarget: true },
    now,
  )
  if (movePlan.result !== 'ok') {
    return {
      nodes: folderPlan.nodes,
      expanded: folderPlan.expanded,
      doc,
      folder: folderPlan.folder,
      moved: false,
    }
  }

  const movedDoc = movePlan.nodes.find((item) => item.id === doc.id) ?? doc
  return {
    nodes: movePlan.nodes,
    expanded: movePlan.expanded,
    doc: movedDoc,
    folder: folderPlan.folder,
    moved: true,
  }
}
