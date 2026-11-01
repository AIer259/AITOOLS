import { generateHTML, mergeAttributes, Node, type Extensions, type JSONContent } from '@tiptap/core'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from '../extensions/Callout'
import { EnhancedTable } from '../extensions/EnhancedTable'

const EmbedPlaceholder = Node.create({
  name: 'documentEmbed',
  group: 'block',
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      docId: { default: null },
      name: { default: '' },
      docType: { default: 'md' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="documentEmbed"]' }]
  },

  renderHTML({ node }) {
    return [
      'div',
      { 'data-type': 'documentEmbed', class: 'embed-placeholder' },
      ['span', { class: 'embed-placeholder-icon' }, '📄'],
      ['span', {}, String(node.attrs.name || '嵌入文档')],
    ]
  },
})

const RenderImage = Node.create({
  name: 'noteImage',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-asset-id'),
        renderHTML: (attributes) => ({ 'data-asset-id': String(attributes.assetId ?? '') }),
      },
      alt: {
        default: '',
        parseHTML: (element) => element.getAttribute('alt') ?? '',
        renderHTML: (attributes) => ({ alt: String(attributes.alt ?? '') }),
      },
      path: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-path') ?? '',
        renderHTML: (attributes) => ({ 'data-path': String(attributes.path ?? '') }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-note-image]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-note-image': '',
        class: 'note-image-render',
      }),
    ]
  },
})

function createRenderExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    Details.configure({
      persist: true,
      HTMLAttributes: { class: 'note-details' },
    }),
    DetailsSummary,
    DetailsContent,
    EnhancedTable,
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    EmbedPlaceholder,
    RenderImage,
  ]
}

export function docJsonToHtml(content?: JSONContent): string {
  if (!content) return ''
  try {
    return generateHTML(content, createRenderExtensions())
  } catch {
    return ''
  }
}
