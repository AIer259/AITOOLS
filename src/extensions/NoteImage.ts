import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ImageNodeView } from '../components/Editor/ImageNodeView'

export const NoteImage = Node.create({
  name: 'noteImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

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
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-note-image': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },
})
