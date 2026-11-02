import { mergeAttributes } from '@tiptap/core'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CodeBlockView } from '../components/Editor/CodeBlockView'
import { codeLowlight } from '../lib/codeHighlight'
import { codeLanguageLabel, normalizeCodeLanguage } from '../lib/codeLanguages'

/** 在 Tiptap 低亮代码块基础上增加语言渲染、名称与可视化选择器 */
export const CodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      codeName: {
        default: '',
        // 名称仅用于编辑器，不写入导出的 HTML
        rendered: false,
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView, {
      stopEvent: ({ event }) => {
        const target = event.target
        return target instanceof HTMLElement && Boolean(target.closest('.note-code-head'))
      },
    })
  },

  renderHTML({ node, HTMLAttributes }) {
    const language = normalizeCodeLanguage(node.attrs.language)
    const rendered = this.parent?.({ node, HTMLAttributes })
    if (!Array.isArray(rendered)) return rendered ?? ['pre', HTMLAttributes, 0]

    const [tag, attributes, child] = rendered as [
      string,
      Record<string, unknown>,
      unknown,
    ]
    return [
      tag,
      mergeAttributes(
        attributes,
        language
          ? {
              'data-language': language,
              'data-language-label': codeLanguageLabel(language),
            }
          : {},
      ),
      child,
    ]
  },
}).configure({
  lowlight: codeLowlight,
  defaultLanguage: 'plaintext',
})
