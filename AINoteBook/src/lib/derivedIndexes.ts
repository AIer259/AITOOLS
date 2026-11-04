import { get, getMany, set, setMany } from 'idb-keyval'
import type { TreeNode } from '../types'
import {
  ASSET_REFS_META_KEY,
  ASSET_REFS_VERSION,
  ASSET_REF_PREFIX,
  assetRefEntry,
} from './assetRefs'
import { loadNodeContent } from './db'
import {
  SEARCH_INDEX_VERSION,
  SEARCH_META_KEY,
  SEARCH_TEXT_PREFIX,
  searchTextEntry,
  type SearchTextRecord,
} from './searchText'
import { contentDocIds } from './treeIndex'

const BATCH_SIZE = 100

interface DerivedMeta {
  version: number
  updatedAt: number
}

let ensurePromise: Promise<void> | null = null
let ensured = false

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function rebuild(nodes: readonly TreeNode[]): Promise<void> {
  const [assetMeta, searchMeta] = await Promise.all([
    get<DerivedMeta>(ASSET_REFS_META_KEY),
    get<DerivedMeta>(SEARCH_META_KEY),
  ])
  const needAssetRefs = assetMeta?.version !== ASSET_REFS_VERSION
  const needSearch = searchMeta?.version !== SEARCH_INDEX_VERSION
  if (!needAssetRefs && !needSearch) return

  const ids = contentDocIds(nodes)

  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE)
    const [contents, existingRefs, existingSearch] = await Promise.all([
      Promise.all(batch.map((id) => loadNodeContent(id))),
      needAssetRefs
        ? getMany<string[]>(batch.map((id) => ASSET_REF_PREFIX + id))
        : Promise.resolve([]),
      needSearch
        ? getMany<SearchTextRecord>(batch.map((id) => SEARCH_TEXT_PREFIX + id))
        : Promise.resolve([]),
    ])

    const entries: Array<[string, unknown]> = []
    batch.forEach((id, index) => {
      if (needAssetRefs && existingRefs[index] === undefined) {
        entries.push(assetRefEntry(id, contents[index]))
      }
      if (needSearch && existingSearch[index] === undefined) {
        entries.push(searchTextEntry(id, contents[index]))
      }
    })

    if (entries.length > 0) await setMany(entries)
    if (start + BATCH_SIZE < ids.length) await yieldToMain()
  }

  const updatedAt = Date.now()
  if (needAssetRefs) {
    await set(ASSET_REFS_META_KEY, {
      version: ASSET_REFS_VERSION,
      updatedAt,
    } satisfies DerivedMeta)
  }
  if (needSearch) {
    await set(SEARCH_META_KEY, {
      version: SEARCH_INDEX_VERSION,
      updatedAt,
    } satisfies DerivedMeta)
  }
}

/** 一次正文扫描同时补齐图片引用与搜索索引；并发调用共享同一个 Promise */
export function ensureDerivedIndexes(nodes: readonly TreeNode[]): Promise<void> {
  if (ensured) return Promise.resolve()
  if (ensurePromise) return ensurePromise

  ensurePromise = rebuild(nodes)
    .then(() => {
      ensured = true
    })
    .finally(() => {
      ensurePromise = null
    })

  return ensurePromise
}
