import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EmbedNodeView } from '../components/Editor/EmbedNodeView'

export const DocumentEmbed = Node.create({
  name: 'documentEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      docId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-doc-id'),
      },
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-name') ?? '',
      },
      docType: {
        default: 'md',
        parseHTML: (element) => element.getAttribute('data-doc-type') ?? 'md',
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="documentEmbed"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'documentEmbed',
        'data-doc-id': String(node.attrs.docId ?? ''),
        'data-doc-type': String(node.attrs.docType ?? 'md'),
        'data-name': String(node.attrs.name ?? ''),
        class: 'embed-node',
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedNodeView)
  },
})
