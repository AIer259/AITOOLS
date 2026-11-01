import type { JSONContent } from '@tiptap/core'
import type { TreeNode } from '../types'

const text = (value: string): JSONContent => ({ type: 'text', text: value })

const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: 'paragraph',
  content,
})

const heading = (level: number, value: string): JSONContent => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
})

const listItem = (value: string): JSONContent => ({
  type: 'listItem',
  content: [paragraph(text(value))],
})

const bulletList = (items: string[]): JSONContent => ({
  type: 'bulletList',
  content: items.map(listItem),
})

const orderedList = (items: string[]): JSONContent => ({
  type: 'orderedList',
  attrs: { start: 1 },
  content: items.map(listItem),
})

const cell = (type: 'tableHeader' | 'tableCell', value: string): JSONContent => ({
  type,
  content: [paragraph(text(value))],
})

const table = (rows: string[][]): JSONContent => ({
  type: 'table',
  content: rows.map((row, rowIndex) => ({
    type: 'tableRow',
    content: row.map((value) => cell(rowIndex === 0 ? 'tableHeader' : 'tableCell', value)),
  })),
})

const details = (summary: string, content: JSONContent[]): JSONContent => ({
  type: 'details',
  attrs: { open: true },
  content: [
    { type: 'detailsSummary', content: [text(summary)] },
    { type: 'detailsContent', content },
  ],
})

const codeBlock = (value: string): JSONContent => ({
  type: 'codeBlock',
  attrs: { language: null },
  content: [text(value)],
})

const doc = (content: JSONContent[]): JSONContent => ({ type: 'doc', content })

const welcomeContent = doc([
  paragraph(
    text('这是一款本地优先的精简笔记工具。左侧管理空间与私人笔记，中间专注写作，右上角提供搜索、目录、导入与导出。'),
  ),
  heading(2, '快速体验'),
  bulletList([
    '在左侧「空间」或「私人」下点击 +，新建文件夹或文档',
    '直接输入 Markdown 语法，例如 # 标题、- 列表、> 引用',
    '输入 / 唤起功能菜单，支持拼音，例如输入 dai 选择代码块',
    '顶部工具栏可以搜索当前文档、查看目录、导入 Word / Markdown、导出',
  ]),
  heading(2, '折叠列表'),
  details('点左侧箭头，展开这段折叠内容', [
    paragraph(text('折叠块适合收纳补充说明、附录，或者暂时不看的细节。')),
    paragraph(text('折叠块内部同样支持列表、表格和代码块。')),
  ]),
  heading(2, '快捷输入'),
  paragraph(text('在空行输入下面的符号，会自动转换成对应格式：')),
  codeBlock('# 一级标题\n- 无序列表\n1. 有序列表\n> 引用\n``` 代码块\n--- 分割线'),
  heading(2, '简单表格'),
  table([
    ['功能', '入口', '说明'],
    ['搜索', '右上角放大镜', '在当前文档内查找并定位'],
    ['目录', '右上角目录按钮', '展开右侧大纲，点击跳转'],
    ['导出', '右上角导出按钮', '支持 Markdown 与 PDF'],
  ]),
  { type: 'horizontalRule' },
  paragraph(text('所有内容自动保存在本机浏览器，刷新页面不会丢失。左下角可以切换浅色 / 深色主题。')),
])

export function createSeedNodes(): TreeNode[] {
  const now = Date.now()

  return [
    {
      id: 'seed-guide',
      area: 'space',
      parentId: null,
      kind: 'folder',
      name: '入门指南',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'seed-welcome',
      area: 'space',
      parentId: 'seed-guide',
      kind: 'doc',
      name: '欢迎使用 AINoteBook',
      docType: 'md',
      content: welcomeContent,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'seed-draft',
      area: 'space',
      parentId: null,
      kind: 'doc',
      name: '产品需求草稿',
      docType: 'md',
      content: doc([
        heading(2, '产品需求草稿'),
        paragraph(text('把想法先记下来，再慢慢整理成结构。')),
        bulletList(['核心目标：写作顺手、查找快速', '下一步：补充导入导出细节', '待确认：是否需要多空间支持']),
      ]),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'seed-personal',
      area: 'private',
      parentId: null,
      kind: 'folder',
      name: '生活记录',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'seed-reading',
      area: 'private',
      parentId: 'seed-personal',
      kind: 'doc',
      name: '本月书单',
      docType: 'md',
      content: doc([
        heading(2, '本月书单'),
        orderedList(['《深度工作》', '《卡片笔记写作法》', '《设计中的设计》']),
        paragraph(text('读完一本，就在下面补一条简短笔记。')),
      ]),
      createdAt: now,
      updatedAt: now,
    },
  ]
}
