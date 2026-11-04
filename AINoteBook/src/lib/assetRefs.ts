import type { JSONContent } from '@tiptap/core'

/** 资源引用索引：正文保存时同步写入，GC 不再读取全部正文 */
export const ASSET_REFS_VERSION = 1
export const ASSET_REFS_META_KEY = 'ainb.assetRefs.v1'
export const ASSET_REF_PREFIX = 'ainb.assetRef.'

export interface AssetRefsMeta {
  version: number
  updatedAt: number
}

/** 收集正文中引用的图片资源 id */
export function collectContentAssetIds(content: JSONContent | undefined): string[] {
  const ids = new Set<string>()

  const visit = (node: JSONContent | undefined) => {
    if (!node) return
    if (node.type === 'noteImage' && node.attrs?.assetId) {
      ids.add(String(node.attrs.assetId))
    }
    node.content?.forEach(visit)
  }

  visit(content)
  return [...ids]
}

export function assetRefEntry(
  id: string,
  content: JSONContent | undefined,
): [string, string[]] {
  return [ASSET_REF_PREFIX + id, collectContentAssetIds(content)]
}
