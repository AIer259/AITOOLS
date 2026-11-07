import type { Extensions } from '@tiptap/core'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { BackgroundColor, Color, TextStyle } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from '../extensions/Callout'
import { CodeBlock } from '../extensions/CodeBlock'
import { DocumentEmbed } from '../extensions/DocumentEmbed'
import { EnhancedTable } from '../extensions/EnhancedTable'
import { MathBlock, MathInline } from '../extensions/Math'
import { NoteImage } from '../extensions/NoteImage'
import { SearchHighlight } from '../extensions/SearchHighlight'
import { SlashCommand } from '../extensions/SlashCommand'

/** 每次调用都返回一套新实例，避免多个编辑器共享扩展状态 */
export function createEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      link: {
        // 只自动识别明确写出的网址，避免 settings.py 这类文件名被当成 .py 域名
        shouldAutoLink: (url) => /^(https?:\/\/|www\.)/i.test(url),
      },
    }),
    TextStyle,
    Color,
    BackgroundColor,
    CodeBlock,
    Placeholder.configure({
      placeholder: '开始输入，或输入 / 唤起功能菜单…',
      emptyEditorClass: 'is-editor-empty',
      includeChildren: true,
    }),
    Details.configure({
      persist: true,
      HTMLAttributes: { class: 'note-details' },
    }),
    DetailsSummary,
    DetailsContent,
    EnhancedTable.configure({
      resizable: false,
      cellMinWidth: 60,
    }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    NoteImage,
    DocumentEmbed,
    MathInline,
    MathBlock,
    SlashCommand,
    SearchHighlight,
  ]
}
