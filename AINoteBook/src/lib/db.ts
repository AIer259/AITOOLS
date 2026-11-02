import { del, get, set } from 'idb-keyval'
import type { TreeNode } from '../types'

const TREE_KEY = 'ainb.tree.v1'
const BLOB_PREFIX = 'ainb.blob.'

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

export async function saveTree(nodes: TreeNode[]): Promise<void> {
  await set(TREE_KEY, nodes)
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
