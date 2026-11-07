import katex from 'katex'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 把 LaTeX 渲染为 KaTeX HTML；空公式显示占位提示，错误公式显示原文 */
export function renderMathHtml(latex: string, displayMode: boolean): string {
  if (!latex.trim()) {
    return '<span class="math-empty">点击编辑公式</span>'
  }

  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    })
  } catch {
    return `<span class="math-error">${escapeHtml(latex)}</span>`
  }
}
