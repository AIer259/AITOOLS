import type { JSONContent } from '@tiptap/core'
import type { Area, DocType, NodeKind, TreeNode } from '../types'
import { attachmentFolderName, isAttachmentFolderName } from '../lib/embedRefs'
import { generateKeyBetween, nextOrder } from '../lib/fractionalIndex'
import { findFolder, firstDoc, getDescendantIds } from '../lib/tree'
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
  nodes: TreeNode[],
  expandedState: Record<string, boolean>,
  input: CreateNodeInput,
  id: string,
  now = Date.now(),
): CreateNodePlan {
  const fallback = input.kind === 'doc' ? '未命名文档' : '新建文件夹'
  const finalName = input.name.trim() || fallback
  const finalDocType = input.docType ?? 'md'
  const siblings = nodes.filter(
    (item) => item.area === input.area && item.parentId === input.parentId,
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

  const nextNodes = [...nodes, node]
  const expanded = { ...expandedState }
  const parentNode = input.parentId
    ? nodes.find((item) => item.id === input.parentId)
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
  nodes: TreeNode[],
  expandedState: Record<string, boolean>,
  id: string,
  target: MoveTarget,
  options?: MoveOptions,
  now = Date.now(),
): MovePlan {
  const node = nodes.find((item) => item.id === id)
  if (!node) return { result: 'invalid', nodes, expanded: expandedState }

  const targetFolder = target.parentId
    ? nodes.find((item) => item.id === target.parentId)
    : undefined
  if (target.parentId && targetFolder?.kind !== 'folder') {
    return { result: 'invalid', nodes, expanded: expandedState }
  }
  if (isAttachmentFolder(nodes, node) || isEmbeddedNode(nodes, node)) {
    return { result: 'invalid', nodes, expanded: expandedState }
  }
  if (
    targetFolder &&
    !options?.allowAttachmentTarget &&
    (isAttachmentFolder(nodes, targetFolder) || isEmbeddedNode(nodes, targetFolder))
  ) {
    return { result: 'invalid', nodes, expanded: expandedState }
  }

  // 根节点集合：普通节点自身；主文档还包括显式关联的附件文件夹
  const rootIds = new Set<string>([id])
  if (node.kind === 'doc' && node.attachmentFolderId) {
    const folder = nodes.find(
      (item) => item.id === node.attachmentFolderId && item.kind === 'folder',
    )
    if (folder) {
      const conflict = findFolder(nodes, target.area, target.parentId, folder.name)
      if (conflict && conflict.id !== folder.id) {
        return { result: 'conflict', nodes, expanded: expandedState }
      }
      rootIds.add(folder.id)
    }
  }

  const movingIds = new Set<string>()
  for (const rootId of rootIds) {
    for (const movingId of getDescendantIds(nodes, rootId)) movingIds.add(movingId)
  }

  if (node.kind === 'folder' && target.parentId && movingIds.has(target.parentId)) {
    return { result: 'invalid', nodes, expanded: expandedState }
  }

  // 换父级时把移动的根节点追加到目标目录末尾；保留已有顺序
  let orderCursor = ''
  for (const item of nodes) {
    if (
      item.area === target.area &&
      item.parentId === target.parentId &&
      !movingIds.has(item.id) &&
      item.order > orderCursor
    ) {
      orderCursor = item.order
    }
  }
  const nextOrders = new Map<string, string>()
  for (const rootId of rootIds) {
    const root = nodes.find((item) => item.id === rootId)
    if (!root) continue
    if (root.area === target.area && root.parentId === target.parentId) {
      nextOrders.set(rootId, root.order)
      continue
    }
    const order = generateKeyBetween(orderCursor || null, null)
    nextOrders.set(rootId, order)
    orderCursor = order
  }

  const nextNodes = nodes.map((item) => {
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

export interface DeletePlan {
  remaining: TreeNode[]
  removed: TreeNode[]
  removedIds: Set<string>
  activeIdFallback: string | null
}

export function planDeleteNode(nodes: TreeNode[], id: string): DeletePlan | null {
  const target = nodes.find((node) => node.id === id)
  if (!target) return null

  const ids = getDescendantIds(nodes, id)

  // 删除文档时一并删除显式关联的附件文件夹
  if (target.kind === 'doc' && target.attachmentFolderId) {
    const folder = nodes.find((node) => node.id === target.attachmentFolderId)
    if (folder) {
      for (const folderId of getDescendantIds(nodes, folder.id)) ids.add(folderId)
    }
  }

  const removed = nodes.filter((node) => ids.has(node.id))
  const remaining = nodes
    .filter((node) => !ids.has(node.id))
    .map((node) => {
      if (
        node.kind === 'doc' &&
        node.attachmentFolderId &&
        ids.has(node.attachmentFolderId)
      ) {
        return { ...node, attachmentFolderId: undefined, updatedAt: Date.now() }
      }
      return node
    })

  return {
    remaining,
    removed,
    removedIds: ids,
    activeIdFallback: firstDoc(remaining)?.id ?? null,
  }
}

export interface EnsureFolderPlan {
  nodes: TreeNode[]
  expanded: Record<string, boolean>
  folder: TreeNode
  created: TreeNode | null
}

export function planEnsureFolder(
  nodes: TreeNode[],
  expandedState: Record<string, boolean>,
  location: { area: Area; parentId: string | null },
  name: string,
  newFolderId: string,
  now = Date.now(),
): EnsureFolderPlan {
  const existing = findFolder(nodes, location.area, location.parentId, name)
  if (existing) {
    return { nodes, expanded: expandedState, folder: existing, created: null }
  }

  const plan = planCreateNode(
    nodes,
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
  nodes: TreeNode[],
  expandedState: Record<string, boolean>,
  note: TreeNode,
  newFolderId: string,
  now = Date.now(),
): AttachmentFolderPlan {
  if (note.attachmentFolderId) {
    const linked = nodes.find(
      (node) => node.id === note.attachmentFolderId && node.kind === 'folder',
    )
    if (linked) {
      return linkAttachmentFolder(nodes, expandedState, note, linked, null, now)
    }
  }

  // 兼容迁移前的旧数据：按名称与兄弟关系找回附件文件夹
  const legacy = findFolder(
    nodes,
    note.area,
    note.parentId,
    attachmentFolderName(note.name),
  )
  if (legacy) {
    return linkAttachmentFolder(nodes, expandedState, note, legacy, null, now)
  }

  const plan = planEnsureFolder(
    nodes,
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
  nodes: TreeNode[],
  expandedState: Record<string, boolean>,
  note: TreeNode,
  doc: TreeNode,
  newFolderId: string,
  now = Date.now(),
): PlaceEmbeddedDocPlan {
  if (doc.kind !== 'doc') {
    return { nodes, expanded: expandedState, doc, folder: null, moved: false }
  }

  const folderPlan = planAttachmentFolder(nodes, expandedState, note, newFolderId, now)
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
    folderPlan.nodes,
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

