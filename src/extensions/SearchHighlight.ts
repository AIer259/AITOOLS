import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface SearchMatch {
  from: number
  to: number
}

export interface SearchState {
  query: string
  activeIndex: number
}

export const searchPluginKey = new PluginKey<SearchState>('searchHighlight')

const MAX_MATCHES = 500

export function findMatches(doc: PMNode, rawQuery: string): SearchMatch[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return []

  const matches: SearchMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text.toLowerCase()
    let offset = 0
    while (matches.length < MAX_MATCHES) {
      const index = text.indexOf(query, offset)
      if (index === -1) break
      const from = pos + index
      matches.push({ from, to: from + query.length })
      offset = index + query.length
    }
  })
  return matches
}

export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init: () => ({ query: '', activeIndex: 0 }),
          apply(transaction, previous) {
            const meta = transaction.getMeta(searchPluginKey) as Partial<SearchState> | undefined
            if (meta) return { ...previous, ...meta }
            return previous
          },
        },
        props: {
          decorations(state) {
            const pluginState = searchPluginKey.getState(state)
            if (!pluginState?.query) return null

            const matches = findMatches(state.doc, pluginState.query)
            if (matches.length === 0) return null

            const activeIndex = Math.min(
              Math.max(pluginState.activeIndex, 0),
              matches.length - 1,
            )

            return DecorationSet.create(
              state.doc,
              matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: index === activeIndex ? 'search-hit current' : 'search-hit',
                }),
              ),
            )
          },
        },
      }),
    ]
  },
})
