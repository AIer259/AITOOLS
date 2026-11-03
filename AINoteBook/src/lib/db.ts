import type { JSONContent } from '@tiptap/core'
import { del, delMany, get, set, setMany } from 'idb-keyval'
import type { Area, DocType, NodeKind, TreeNode } from '../types'

const TREE_KEY = 'ainb.tree.v2'
const LEGACY_TREE_KEY = 'ainb.tree.v1'
const NODE_PREFIX = 'ainb.node.'
const BLOB_PREFIX = 'ainb.blob.'

export interface LegacyTreeNode {
  id: string
  area: Area
  parentId: string | null
  kind: NodeKind
  name: string
  order?: string
  docType?: DocType
  content?: JSONContent
  blobId?: string
  attachmentFolderId?: string
  ownerDocId?: string
  createdAt: number
  updatedAt: number
}

export function createBlobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `blob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function loadTree(): Promise<TreeNode[] | null> {
  try {
    const value = await get<TreeNode[]>(TREE_KEY)
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export async function loadLegacyTree(): Promise<LegacyTreeNode[] | null> {
  try {
    const value = await get<LegacyTreeNode[]>(LEGACY_TREE_KEY)
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export async function saveTree(nodes: TreeNode[]): Promise<void> {
  await set(TREE_KEY, nodes)
}

/** 树元数据与正文在同一个事务里写入，避免只写一半 */
export async function saveTreeWithContents(
  nodes: TreeNode[],
  contents: Map<string, JSONContent>,
): Promise<void> {
  const entries: Array<[string, unknown]> = [[TREE_KEY, nodes]]
  for (const [id, content] of contents) {
    entries.push([NODE_PREFIX + id, content])
  }
  await setMany(entries)
}

export async function loadNodeContent(id: string): Promise<JSONContent | undefined> {
  return get<JSONContent>(NODE_PREFIX + id)
}

export async function saveNodeContent(id: string, content: JSONContent): Promise<void> {
  await set(NODE_PREFIX + id, content)
}

export async function removeNodeContents(ids: Iterable<string>): Promise<void> {
  const keys = [...ids].map((id) => NODE_PREFIX + id)
  if (keys.length === 0) return
  await delMany(keys)
}

export async function saveBlob(id: string, data: ArrayBuffer): Promise<void> {
  await set(BLOB_PREFIX + id, data)
}

export async function loadBlob(id: string): Promise<ArrayBuffer | undefined> {
  return get<ArrayBuffer>(BLOB_PREFIX + id)
}

export async function removeBlob(id: string): Promise<void> {
  await del(BLOB_PREFIX + id)
}
