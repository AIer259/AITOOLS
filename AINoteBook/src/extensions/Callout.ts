import { mergeAttributes, Node } from '@tiptap/core'

/** 带图标与边框的重点提示块 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [
      {
        tag: 'div[data-callout]',
        contentElement: '.note-callout-body',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': '',
        class: 'note-callout',
      }),
      [
        'span',
        {
          class: 'note-callout-icon',
          contenteditable: 'false',
          role: 'img',
          'aria-label': '注意',
        },
        '💡',
      ],
      ['div', { class: 'note-callout-body' }, 0],
    ]
  },
})
