import { getMarkRange, type Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export interface LinkRange {
  from: number
  to: number
  href: string
  text: string
}

/** 按文档位置查找链接 mark 的完整范围 */
export function getLinkRangeAt(editor: Editor, pos: number): LinkRange | null {
  const linkType = editor.schema.marks.link
  if (!linkType) return null

  const range = getMarkRange(editor.state.doc.resolve(pos), linkType)
  if (!range) return null

  const $start = editor.state.doc.resolve(
    Math.min(range.from + 1, editor.state.doc.content.size),
  )
  const href = String($start.marks().find((mark) => mark.type === linkType)?.attrs.href ?? '')
  if (!href) return null

  return {
    from: range.from,
    to: range.to,
    href,
    text: editor.state.doc.textBetween(range.from, range.to, ' '),
  }
}

/** 当前文字选区对应的链接范围；空选区返回 null */
export function getSelectionLinkRange(editor: Editor): LinkRange | null {
  const selection = editor.state.selection
  if (!(selection instanceof TextSelection) || selection.empty) return null

  const { from, to } = selection
  const text = editor.state.doc.textBetween(from, to, ' ')
  if (!text.trim()) return null

  return {
    from,
    to,
    href: String((editor.getAttributes('link').href as string | undefined) ?? ''),
    text,
  }
}

/** 给指定文本范围设置链接地址；标题变化时同时替换显示文字 */
export function applyLink(
  editor: Editor,
  range: LinkRange,
  url: string,
  title: string,
): void {
  const linkType = editor.schema.marks.link
  if (!linkType) return

  const nextUrl = url.trim()
  const nextTitle = title.trim()
  if (!nextUrl || !nextTitle) return

  const { state, view } = editor
  const from = Math.max(0, Math.min(range.from, state.doc.content.size))
  const to = Math.max(from, Math.min(range.to, state.doc.content.size))
  if (from >= to) return

  const tr = state.tr
  if (nextTitle !== range.text) {
    tr.insertText(nextTitle, from, to)
    tr.addMark(from, from + nextTitle.length, linkType.create({ href: nextUrl }))
    tr.setSelection(TextSelection.create(tr.doc, from + nextTitle.length))
  } else {
    tr.addMark(from, to, linkType.create({ href: nextUrl }))
  }

  tr.scrollIntoView()
  view.dispatch(tr)
  view.focus()
}

/** 移除指定范围的链接 mark，文字保留 */
export function removeLink(editor: Editor, range: LinkRange): void {
  const linkType = editor.schema.marks.link
  if (!linkType) return

  const { state, view } = editor
  const from = Math.max(0, Math.min(range.from, state.doc.content.size))
  const to = Math.max(from, Math.min(range.to, state.doc.content.size))
  if (from >= to) return

  view.dispatch(state.tr.removeMark(from, to, linkType))
  view.focus()
}
