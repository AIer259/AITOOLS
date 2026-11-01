import type { Extensions } from '@tiptap/core'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from '../extensions/Callout'
import { DocumentEmbed } from '../extensions/DocumentEmbed'
import { EnhancedTable } from '../extensions/EnhancedTable'
import { NoteImage } from '../extensions/NoteImage'
import { SearchHighlight } from '../extensions/SearchHighlight'
import { SlashCommand } from '../extensions/SlashCommand'

/** 每次调用都返回一套新实例，避免多个编辑器共享扩展状态 */
export function createEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
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
    SlashCommand,
    SearchHighlight,
  ]
}
