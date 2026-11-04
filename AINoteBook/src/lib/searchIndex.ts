import { getMany, setMany } from 'idb-keyval'
import type { TreeNode } from '../types'
import { loadNodeContent } from './db'
import { ensureDerivedIndexes } from './derivedIndexes'
import {
  searchDocuments,
  type SearchDocument,
  type SearchMatch,
} from './searchQuery'
import {
  SEARCH_TEXT_PREFIX,
  searchTextEntry,
  type SearchTextRecord,
} from './searchText'
import { formatNodePath } from './tree'
import { contentDocIds, getTreeIndex } from './treeIndex'

let cache: Map<string, SearchTextRecord> | null = null
let loading: Promise<Map<string, SearchTextRecord>> | null = null
let generation = 0
const pendingUpdates = new Map<string, SearchTextRecord>()

export interface SearchResult extends SearchMatch {
  path: string
}

const FILL_BATCH_SIZE = 100

async function fillMissing(
  ids: readonly string[],
  records: Map<string, SearchTextRecord>,
): Promise<void> {
  for (let start = 0; start < ids.length; start += FILL_BATCH_SIZE) {
    const batch = ids.slice(start, start + FILL_BATCH_SIZE)
    const contents = await Promise.all(batch.map((id) => loadNodeContent(id)))
    const entries: Array<[string, SearchTextRecord]> = []

    batch.forEach((id, index) => {
      const entry = searchTextEntry(id, contents[index])
      records.set(id, entry[1])
      entries.push(entry)
    })

    if (entries.length > 0) await setMany(entries)
    if (start + FILL_BATCH_SIZE < ids.length) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
}

async function loadRecords(nodes: readonly TreeNode[]): Promise<Map<string, SearchTextRecord>> {
  await ensureDerivedIndexes(nodes)

  const ids = contentDocIds(nodes)
  const stored = await getMany<SearchTextRecord>(
    ids.map((id) => SEARCH_TEXT_PREFIX + id),
  )
  const records = new Map<string, SearchTextRecord>()
  const missing: string[] = []

  ids.forEach((id, index) => {
    const record = stored[index]
    if (record) records.set(id, record)
    else missing.push(id)
  })

  await fillMissing(missing, records)
  return records
}

/** 加载搜索缓存；首次会触发共用索引构建 */
export function ensureSearchCache(
  nodes: readonly TreeNode[],
): Promise<Map<string, SearchTextRecord>> {
  if (cache) return Promise.resolve(cache)
  if (loading) return loading

  const currentGeneration = generation
  const promise = loadRecords(nodes)
    .then((records) => {
      if (currentGeneration !== generation) return records
      for (const [id, record] of pendingUpdates) records.set(id, record)
      pendingUpdates.clear()
      cache = records
      return records
    })
    .finally(() => {
      if (loading === promise) loading = null
    })

  loading = promise
  return promise
}

/** 保存后更新已加载的缓存；缓存未加载时直接忽略 */
export function updateSearchCache(
  records: Map<string, SearchTextRecord>,
): void {
  if ((!cache && !loading) || records.size === 0) return

  for (const [id, record] of records) {
    if (cache) cache.set(id, record)
    if (loading) pendingUpdates.set(id, record)
  }
}

export function removeSearchCache(ids: Iterable<string>): void {
  for (const id of ids) {
    cache?.delete(id)
    pendingUpdates.delete(id)
  }
}

export function invalidateSearchCache(): void {
  generation += 1
  cache = null
  loading = null
  pendingUpdates.clear()
}

export async function searchAll(
  query: string,
  nodes: readonly TreeNode[],
): Promise<SearchResult[]> {
  if (!query.trim()) return []

  const records = await ensureSearchCache(nodes)
  const index = getTreeIndex(nodes)
  const missing = index.activeDocs
    .filter((node) => !records.has(node.id))
    .map((node) => node.id)
  if (missing.length > 0) await fillMissing(missing, records)
  const docs: SearchDocument[] = []

  for (const node of index.activeDocs) {
    const record = records.get(node.id)
    if (!record) continue
    docs.push({
      id: node.id,
      name: node.name,
      text: record.text,
      lower: record.lower,
    })
  }

  return searchDocuments(query, docs).map((match) => {
    const node = index.byId.get(match.id)
    return {
      ...match,
      path: node ? formatNodePath(index, node) : '',
    }
  })
}
