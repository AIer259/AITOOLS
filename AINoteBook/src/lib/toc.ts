import type { Editor } from '@tiptap/core'

export interface TocItem {
  pos: number
  level: number
  text: string
}

export interface TocNode extends TocItem {
  id: string
  children: TocNode[]
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

/** 按标题级别构建目录树，并给每个节点分配稳定的路径 ID */
export function buildTocTree(items: TocItem[]): TocNode[] {
  const roots: TocNode[] = []
  const stack: TocNode[] = []

  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]
    const siblings = parent ? parent.children : roots
    const node: TocNode = {
      ...item,
      id: parent ? `${parent.id}/${siblings.length}` : String(siblings.length),
      children: [],
    }

    siblings.push(node)
    stack.push(node)
  }

  return roots
}

// 默认只显示一、二级；二级节点折叠后即隐藏三级及之后
export const DEFAULT_COLLAPSED_LEVEL = 2

/** 默认三级及之后折叠；手动切换结果优先 */
export function isTocCollapsed(
  node: TocNode,
  overrides: ReadonlyMap<string, boolean>,
): boolean {
  return overrides.get(node.id) ?? node.level >= DEFAULT_COLLAPSED_LEVEL
}

/** 展开为可见行；折叠节点的整棵子树都会被跳过 */
export function flattenToc(
  nodes: TocNode[],
  overrides: ReadonlyMap<string, boolean>,
): TocNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(isTocCollapsed(node, overrides) ? [] : flattenToc(node.children, overrides)),
  ])
}
