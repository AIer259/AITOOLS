import type { Editor } from '@tiptap/core'

export interface TocItem {
  pos: number
  level: number
  text: string
}

export function extractToc(editor: Editor): TocItem[] {
  const items: TocItem[] = []

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    const level = Number(node.attrs.level) || 1
    const text = node.textContent.trim()
    items.push({
      pos,
      level: Math.min(Math.max(level, 1), 6),
      text: text || '无标题',
    })
  })

  return items
}
