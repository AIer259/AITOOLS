export interface SearchDocument {
  id: string
  name: string
  text: string
  lower: string
}

export interface SearchMatch {
  id: string
  name: string
  snippet: string
  snippetMatchStart: number
  snippetMatchLength: number
  titleMatch: boolean
  matches: number
}

const SNIPPET_BEFORE = 40
const SNIPPET_AFTER = 80
const MAX_MATCHES = 100

function makeSnippet(
  text: string,
  index: number,
  matchLength: number,
): Pick<SearchMatch, 'snippet' | 'snippetMatchStart' | 'snippetMatchLength'> {
  const start = Math.max(0, index - SNIPPET_BEFORE)
  const end = Math.min(text.length, index + matchLength + SNIPPET_AFTER)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''

  return {
    snippet: `${prefix}${text.slice(start, end)}${suffix}`,
    snippetMatchStart: prefix.length + index - start,
    snippetMatchLength: matchLength,
  }
}

function countMatches(lower: string, query: string, firstIndex: number): number {
  let count = 1
  let offset = firstIndex + query.length

  while (count < MAX_MATCHES) {
    const index = lower.indexOf(query, offset)
    if (index < 0) break
    count += 1
    offset = index + query.length
  }

  return count
}

export function searchDocuments(
  rawQuery: string,
  docs: readonly SearchDocument[],
  limit = 30,
): SearchMatch[] {
  const query = rawQuery.trim()
  if (!query) return []
  const needle = query.toLowerCase()
  const results: Array<SearchMatch & { score: number }> = []

  for (const doc of docs) {
    const titleMatch = doc.name.toLowerCase().includes(needle)
    const bodyIndex = doc.lower.indexOf(needle)
    if (!titleMatch && bodyIndex < 0) continue

    const matches =
      bodyIndex >= 0 ? countMatches(doc.lower, needle, bodyIndex) : 0
    const snippet =
      bodyIndex >= 0
        ? makeSnippet(doc.text, bodyIndex, query.length)
        : {
            snippet:
              doc.text.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER) || '标题匹配',
            snippetMatchStart: -1,
            snippetMatchLength: 0,
          }

    results.push({
      id: doc.id,
      name: doc.name,
      ...snippet,
      titleMatch,
      matches,
      score: (titleMatch ? 1000 : 0) + Math.min(matches, MAX_MATCHES),
    })
  }

  results.sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-CN'),
  )
  return results.slice(0, limit).map(({ score, ...result }) => {
    void score
    return result
  })
}
