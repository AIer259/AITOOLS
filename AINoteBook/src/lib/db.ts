import type { JSONContent } from '@tiptap/core'
import { del, delMany, get, set, setMany } from 'idb-keyval'
import type { Area, DocType, NodeKind, TreeNode } from '../types'
import { ASSET_REF_PREFIX, collectContentAssetIds } from './assetRefs'
import {
  SEARCH_TEXT_PREFIX,
  buildSearchRecords,
  type SearchTextRecord,
} from './searchText'

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

interface ContentPayload {
  entries: Array<[string, unknown]>
  searchRecords: Map<string, SearchTextRecord>
}

/** 内存中记录每个文档已写入的图片引用；保存时只有集合变化才重写引用键 */
const writtenAssetRefs = new Map<string, string[]>()

function sameRefSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

function buildContentPayload(contents: Map<string, JSONContent>): ContentPayload {
  const entries: Array<[string, unknown]> = []
  const newRefs = new Map<string, string[]>()
  for (const [id, content] of contents) {
    entries.push([NODE_PREFIX + id, content])
    const refs = collectContentAssetIds(content)
    const previous = writtenAssetRefs.get(id)
    if (!previous || !sameRefSet(previous, refs)) {
      entries.push([ASSET_REF_PREFIX + id, refs])
      newRefs.set(id, refs)
    }
  }

  const searchRecords = buildSearchRecords(contents)
  for (const [id, record] of searchRecords) {
    entries.push([SEARCH_TEXT_PREFIX + id, record])
  }

  return { entries, searchRecords }
}

/** 树元数据、正文、图片引用与搜索文本在同一个事务里写入，避免只写一半 */
export async function saveTreeWithContents(
  nodes: TreeNode[],
  contents: Map<string, JSONContent>,
): Promise<Map<string, SearchTextRecord>> {
  const { entries, searchRecords } = buildContentPayload(contents)
  await setMany([[TREE_KEY, nodes], ...entries])
  for (const [id, content] of contents) {
    writtenAssetRefs.set(id, collectContentAssetIds(content))
  }
  return searchRecords
}

/** 只写正文、图片引用与搜索文本；结构未变时使用，避免重写整棵树 */
export async function saveNodeContents(
  contents: Map<string, JSONContent>,
): Promise<Map<string, SearchTextRecord>> {
  if (contents.size === 0) return new Map()

  const { entries, searchRecords } = buildContentPayload(contents)
  await setMany(entries)
  for (const [id, content] of contents) {
    writtenAssetRefs.set(id, collectContentAssetIds(content))
  }
  return searchRecords
}

export async function loadNodeContent(id: string): Promise<JSONContent | undefined> {
  return get<JSONContent>(NODE_PREFIX + id)
}

export async function saveNodeContent(id: string, content: JSONContent): Promise<void> {
  await saveNodeContents(new Map([[id, content]]))
}

export async function removeNodeContents(ids: Iterable<string>): Promise<void> {
  const list = [...ids]
  if (list.length === 0) return
  for (const id of list) writtenAssetRefs.delete(id)
  await delMany([
    ...list.map((id) => NODE_PREFIX + id),
    ...list.map((id) => ASSET_REF_PREFIX + id),
    ...list.map((id) => SEARCH_TEXT_PREFIX + id),
  ])
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
