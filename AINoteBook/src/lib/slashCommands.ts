import type { Editor, Range } from '@tiptap/core'

export type SlashIcon =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'code'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'table'
  | 'toggle'
  | 'embed'

export interface SlashItem {
  id: string
  title: string
  hint: string
  icon: SlashIcon
  pinyin: string[]
  keywords: string[]
  opensEmbedPicker?: boolean
  run: (editor: Editor, range: Range) => void
}

const start = (editor: Editor, range: Range) =>
  editor.chain().focus().deleteRange(range)

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'paragraph',
    title: '正文',
    hint: '普通文本段落',
    icon: 'text',
    pinyin: ['zhengwen', 'zw', 'duanluo'],
    keywords: ['text', 'paragraph', 'p', '正文', '段落'],
    run: (editor, range) => start(editor, range).setParagraph().run(),
  },
  {
    id: 'heading1',
    title: '标题1',
    hint: '大标题',
    icon: 'h1',
    pinyin: ['biaoti1', 'biaotiyi', 'bt1'],
    keywords: ['h1', 'heading1', 'heading', '标题一', '大标题'],
    run: (editor, range) => start(editor, range).setHeading({ level: 1 }).run(),
  },
  {
    id: 'heading2',
    title: '标题2',
    hint: '中标题',
    icon: 'h2',
    pinyin: ['biaoti2', 'biaotier', 'bt2'],
    keywords: ['h2', 'heading2', 'heading', '标题二', '中标题'],
    run: (editor, range) => start(editor, range).setHeading({ level: 2 }).run(),
  },
  {
    id: 'heading3',
    title: '标题3',
    hint: '小标题',
    icon: 'h3',
    pinyin: ['biaoti3', 'biaotisan', 'bt3'],
    keywords: ['h3', 'heading3', 'heading', '标题三', '小标题'],
    run: (editor, range) => start(editor, range).setHeading({ level: 3 }).run(),
  },
  {
    id: 'heading4',
    title: '标题4',
    hint: '四级标题',
    icon: 'h4',
    pinyin: ['biaoti4', 'biaotisi', 'bt4'],
    keywords: ['h4', 'heading4', 'heading', '标题四', '四级标题'],
    run: (editor, range) => start(editor, range).setHeading({ level: 4 }).run(),
  },
  {
    id: 'heading5',
    title: '标题5',
    hint: '五级标题',
    icon: 'h5',
    pinyin: ['biaoti5', 'biaotiwu', 'bt5'],
    keywords: ['h5', 'heading5', 'heading', '标题五', '五级标题'],
    run: (editor, range) => start(editor, range).setHeading({ level: 5 }).run(),
  },
  {
    id: 'bulletList',
    title: '项目列表',
    hint: '无序列表',
    icon: 'bullet',
    pinyin: ['xiangmuliebiao', 'xiangmu', 'xmlb'],
    keywords: ['bullet', 'list', 'ul', '无序列表', '项目符号'],
    run: (editor, range) => start(editor, range).toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    title: '有序列表',
    hint: '带编号的列表',
    icon: 'ordered',
    pinyin: ['youxuliebiao', 'youxu', 'yxlb'],
    keywords: ['ordered', 'number', 'ol', '编号列表'],
    run: (editor, range) => start(editor, range).toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    title: '待办事项',
    hint: '可勾选的清单',
    icon: 'task',
    pinyin: ['daibanshixiang', 'daiban', 'dbsx'],
    keywords: ['todo', 'task', 'checkbox', 'checklist', '待办'],
    run: (editor, range) => start(editor, range).toggleTaskList().run(),
  },
  {
    id: 'codeBlock',
    title: '代码块',
    hint: '等宽字体代码区域',
    icon: 'code',
    pinyin: ['daimakuai', 'daima', 'dmk'],
    keywords: ['code', 'pre', '代码'],
    run: (editor, range) => start(editor, range).toggleCodeBlock().run(),
  },
  {
    id: 'blockquote',
    title: '引用',
    hint: '引用一段内容',
    icon: 'quote',
    pinyin: ['yinyong', 'yy'],
    keywords: ['quote', 'blockquote', '引用'],
    run: (editor, range) => start(editor, range).toggleBlockquote().run(),
  },
  {
    id: 'callout',
    title: '着重块',
    hint: '带图标的重点提示框',
    icon: 'callout',
    pinyin: ['zhuozhongkuai', 'zhuozhong', 'zzk'],
    keywords: ['callout', 'tip', 'note', 'important', 'highlight', '着重', '重点', '提示'],
    run: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContentAt(range.from, {
          type: 'callout',
          content: [{ type: 'paragraph' }],
        })
        .setTextSelection(range.from + 2)
        .run()
    },
  },
  {
    id: 'divider',
    title: '分割线',
    hint: '一条水平分隔线',
    icon: 'divider',
    pinyin: ['fengexian', 'fgx'],
    keywords: ['hr', 'divider', 'horizontalrule', '分割线'],
    run: (editor, range) => start(editor, range).setHorizontalRule().run(),
  },
  {
    id: 'table',
    title: '复杂表格',
    hint: '可加行/列、调整列宽',
    icon: 'table',
    pinyin: ['fuzabiaoge', 'fuza', 'fz', 'biaoge', 'jiandanbiaoge', 'jdbg'],
    keywords: ['f', 'complex', 'advanced', 'table', 'grid', '复杂', '复杂表格', '表格', '简单表格'],
    run: (editor, range) =>
      start(editor, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'details',
    title: '折叠列表',
    hint: '可展开 / 收起的内容块',
    icon: 'toggle',
    pinyin: ['zhedieliebiao', 'zhedie', 'zdlb'],
    keywords: ['toggle', 'fold', 'details', '折叠'],
    run: (editor, range) => start(editor, range).setDetails().run(),
  },
  {
    id: 'embedDocument',
    title: '嵌入文档',
    hint: '插入 Markdown / PDF / Word 文档',
    icon: 'embed',
    pinyin: ['qianruwendang', 'qianru', 'qrwd'],
    keywords: ['embed', 'document', 'doc', 'file', '嵌入', '插入文档'],
    opensEmbedPicker: true,
    run: (editor, range) => {
      start(editor, range).run()
    },
  },
]

function scorePinyin(item: SlashItem, query: string): number {
  let best = 0
  for (const pinyin of item.pinyin) {
    if (pinyin === query) best = Math.max(best, 96)
    else if (pinyin.startsWith(query)) {
      best = Math.max(best, 78 - Math.min(12, pinyin.length / 2))
    } else if (pinyin.includes(query)) {
      best = Math.max(best, 60 - Math.min(12, pinyin.length / 3))
    }
  }
  return best
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0
  for (const char of haystack) {
    if (char === needle[index]) index += 1
    if (index === needle.length) return true
  }
  return needle.length === 0
}

function scoreItem(item: SlashItem, query: string): number {
  const title = item.title.toLowerCase()
  if (title === query) return 100
  if (title.startsWith(query)) return 90
  if (title.includes(query)) return 82

  for (const keyword of item.keywords) {
    const word = keyword.toLowerCase()
    if (word === query) return 88
    if (word.startsWith(query)) return 72
    if (word.includes(query)) return 58
  }

  const pinyinScore = scorePinyin(item, query)
  if (pinyinScore > 0) return pinyinScore

  if (query.length >= 2) {
    const joined = item.pinyin.join('')
    if (isSubsequence(query, joined)) return 30
  }

  return 0
}

export function filterSlashItems(query: string): SlashItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return SLASH_ITEMS

  return SLASH_ITEMS.map((item, index) => ({ item, index, score: scoreItem(item, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item)
}
