import { common, createLowlight } from 'lowlight'
import clojure from 'highlight.js/lib/languages/clojure'
import dart from 'highlight.js/lib/languages/dart'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import elixir from 'highlight.js/lib/languages/elixir'
import erlang from 'highlight.js/lib/languages/erlang'
import groovy from 'highlight.js/lib/languages/groovy'
import haskell from 'highlight.js/lib/languages/haskell'
import julia from 'highlight.js/lib/languages/julia'
import matlab from 'highlight.js/lib/languages/matlab'
import nginx from 'highlight.js/lib/languages/nginx'
import powershell from 'highlight.js/lib/languages/powershell'
import scala from 'highlight.js/lib/languages/scala'
import { normalizeCodeLanguage } from './codeLanguages'
import { escapeHtml } from './html'

export const codeLowlight = createLowlight(common)

codeLowlight.register({
  clojure,
  dart,
  dockerfile,
  elixir,
  erlang,
  groovy,
  haskell,
  julia,
  matlab,
  nginx,
  powershell,
  scala,
})

// Vue / Svelte 单文件组件在 highlight.js 中没有独立语法，按 XML 处理
codeLowlight.registerAlias({ xml: ['vue', 'svelte'] })

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

function hastToHtml(node: HastNode): string {
  if (node.type === 'text') return escapeHtml(node.value ?? '')

  const children = (node.children ?? []).map(hastToHtml).join('')
  if (node.type !== 'element') return children

  const tag = node.tagName ?? 'span'
  const attributes: string[] = []

  for (const [key, value] of Object.entries(node.properties ?? {})) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'className') {
      const className = Array.isArray(value) ? value.join(' ') : String(value)
      attributes.push(`class="${escapeHtml(className)}"`)
    } else if (typeof value === 'string' || typeof value === 'number') {
      attributes.push(`${key}="${escapeHtml(String(value))}"`)
    }
  }

  const suffix = attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
  return `<${tag}${suffix}>${children}</${tag}>`
}

/** 返回带 hljs span 的代码 HTML；纯文本或未注册语言返回 null */
export function highlightCodeHtml(language: unknown, code: string): string | null {
  const normalized = normalizeCodeLanguage(language)
  if (!normalized || !code || !codeLowlight.registered(normalized)) return null

  try {
    const tree = codeLowlight.highlight(normalized, code) as unknown as HastNode
    return hastToHtml(tree)
  } catch {
    return null
  }
}

/** 就地给容器中的代码块补上语法高亮，供导出与只读预览使用 */
export function highlightCodeElements(root: ParentNode): void {
  root.querySelectorAll('pre').forEach((pre) => {
    const code = pre.firstElementChild
    if (!code || code.tagName !== 'CODE') return

    const language =
      pre.getAttribute('data-language') ||
      code.className.match(/language-([^\s]+)/)?.[1] ||
      ''
    const highlighted = highlightCodeHtml(language, code.textContent ?? '')
    if (highlighted !== null) code.innerHTML = highlighted
  })
}

export function highlightCodeInHtml(html: string): string {
  if (!html.includes('data-language') && !html.includes('language-')) return html

  const container = document.createElement('div')
  container.innerHTML = html
  highlightCodeElements(container)
  return container.innerHTML
}
