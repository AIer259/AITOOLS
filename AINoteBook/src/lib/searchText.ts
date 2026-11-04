import type { JSONContent } from '@tiptap/core'

export const SEARCH_INDEX_VERSION = 1
export const SEARCH_META_KEY = 'ainb.searchIndex.v1'
export const SEARCH_TEXT_PREFIX = 'ainb.search.'

export interface SearchTextRecord {
  text: string
  lower: string
}

/** 从 TipTap JSON 提取可检索纯文本 */
export function extractSearchText(content: JSONContent | undefined): string {
  const parts: string[] = []

  const visit = (node: JSONContent | undefined) => {
    if (!node) return
    if (typeof node.text === 'string' && node.text) parts.push(node.text)
    if (node.type === 'noteImage' && node.attrs?.alt) {
      parts.push(String(node.attrs.alt))
    }
    if (node.type === 'documentEmbed' && node.attrs?.name) {
      parts.push(String(node.attrs.name))
    }
    node.content?.forEach(visit)
  }

  visit(content)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function buildSearchTextRecord(
  content: JSONContent | undefined,
): SearchTextRecord {
  const text = extractSearchText(content)
  return { text, lower: text.toLowerCase() }
}

export function searchTextEntry(
  id: string,
  content: JSONContent | undefined,
): [string, SearchTextRecord] {
  return [SEARCH_TEXT_PREFIX + id, buildSearchTextRecord(content)]
}

export function buildSearchRecords(
  contents: Map<string, JSONContent>,
): Map<string, SearchTextRecord> {
  return new Map(
    [...contents].map(([id, content]) => [id, buildSearchTextRecord(content)]),
  )
}
