import { InputRule, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MathNodeView } from '../components/Editor/MathNodeView'
import { renderMathHtml } from '../lib/mathRender'

const latexAttribute = {
  latex: {
    default: '',
    parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') ?? '',
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-latex': String(attributes.latex ?? ''),
    }),
  },
}

/** 行内公式：$E=mc^2$ */
export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return latexAttribute
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }]
  },

  renderHTML({ node }) {
    const dom = document.createElement('span')
    dom.className = 'math-inline'
    dom.setAttribute('data-math-inline', '')
    dom.setAttribute('data-latex', String(node.attrs.latex ?? ''))
    dom.innerHTML = renderMathHtml(String(node.attrs.latex ?? ''), false)
    return { dom }
  },

  addInputRules() {
    const type = this.type
    return [
      new InputRule({
        find: /\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1]?.trim()
          if (!latex) return
          state.tr.replaceRangeWith(range.from, range.to, type.create({ latex }))
        },
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView)
  },
})

/** 块级公式：独立居中的公式块 */
export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return latexAttribute
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }]
  },

  renderHTML({ node }) {
    const dom = document.createElement('div')
    dom.className = 'math-block'
    dom.setAttribute('data-math-block', '')
    dom.setAttribute('data-latex', String(node.attrs.latex ?? ''))
    dom.innerHTML = renderMathHtml(String(node.attrs.latex ?? ''), true)
    return { dom }
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView)
  },
})
