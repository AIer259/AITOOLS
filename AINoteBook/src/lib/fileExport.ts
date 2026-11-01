import type { Editor } from '@tiptap/core'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { EXPORT_CSS } from './exportStyles'
import { extensionForMime, getAssetMeta, loadAssetBlob } from './imageAssets'

interface ExportImage {
  path: string
  blob: Blob
}

interface HydratedExport {
  html: string
  images: ExportImage[]
}

interface NormalizeExportOptions {
  keepColgroup?: boolean
}

function normalizeExportHtml(
  html: string,
  { keepColgroup = false }: NormalizeExportOptions = {},
): string {
  const container = document.createElement('div')
  container.innerHTML = html

  container.querySelectorAll('[data-type="details"]').forEach((detailsNode) => {
    const summaryNode = detailsNode.querySelector('[data-type="detailsSummary"]')
    const contentNode = detailsNode.querySelector('[data-type="detailsContent"]')
    const details = document.createElement('details')
    details.open = true
    const summary = document.createElement('summary')
    summary.innerHTML = summaryNode?.innerHTML ?? '折叠内容'
    const content = document.createElement('div')
    content.innerHTML = contentNode?.innerHTML ?? ''
    details.append(summary, content)
    detailsNode.replaceWith(details)
  })

  container.querySelectorAll('button').forEach((button) => button.remove())
  if (!keepColgroup) {
    container.querySelectorAll('table colgroup').forEach((colgroup) => colgroup.remove())
  }

  // 待办列表重排成 turndown-gfm 能识别的结构：li > input[type=checkbox]
  container.querySelectorAll('ul[data-type="taskList"]').forEach((list) => {
    list.querySelectorAll(':scope > li').forEach((item) => {
      const checked = item.getAttribute('data-checked') === 'true'
      const content = item.querySelector(':scope > div')
      const nextItem = document.createElement('li')

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = checked
      checkbox.disabled = true
      if (checked) checkbox.setAttribute('checked', 'checked')

      nextItem.append(checkbox, document.createTextNode(' '))
      if (content) {
        while (content.firstChild) nextItem.appendChild(content.firstChild)
      }
      item.replaceWith(nextItem)
    })
  })

  // 列表与表格单元格里的段落去掉外层 p，避免 Markdown 表格被换行破坏
  container.querySelectorAll('li > p, th p, td p').forEach((paragraph) => {
    const fragment = document.createDocumentFragment()
    while (paragraph.firstChild) fragment.appendChild(paragraph.firstChild)
    paragraph.replaceWith(fragment, document.createTextNode(' '))
  })

  container.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.setAttribute('disabled', 'disabled')
  })
  container.querySelectorAll('[contenteditable]').forEach((element) => {
    element.removeAttribute('contenteditable')
  })

  // 嵌入文档在导出文件里显示为说明卡片
  container.querySelectorAll('[data-type="documentEmbed"]').forEach((embed) => {
    const name = embed.getAttribute('data-name') || '嵌入文档'
    const type = embed.getAttribute('data-doc-type')
    const label = type === 'pdf' ? 'PDF' : type === 'docx' ? 'Word' : 'Markdown'
    const card = document.createElement('div')
    card.className = 'export-embed'
    card.textContent = `📄 嵌入文档：${name}（${label}）`
    embed.replaceWith(card)
  })

  return container.innerHTML
}

export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return cleaned || '未命名文档'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

function safeFolderName(name: string): string {
  const folder = safeFileName(name)
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
  return folder || '未命名文档'
}

async function hydrateImagesForExport(
  html: string,
  title: string,
  mode: 'data-url' | 'files',
): Promise<HydratedExport> {
  const container = document.createElement('div')
  container.innerHTML = html

  const folder = safeFolderName(title)
  const images: ExportImage[] = []
  const cache = new Map<string, { src: string; image?: ExportImage }>()

  for (const image of Array.from(container.querySelectorAll<HTMLImageElement>('img[data-note-image]'))) {
    const assetId = image.getAttribute('data-asset-id')
    if (!assetId) {
      image.remove()
      continue
    }

    let cached = cache.get(assetId)
    if (!cached) {
      const [meta, blob] = await Promise.all([getAssetMeta(assetId), loadAssetBlob(assetId)])
      if (!blob) {
        image.remove()
        continue
      }

      const mime = meta?.mime || blob.type || 'image/png'
      const filename = `${assetId.slice(0, 12)}.${extensionForMime(mime)}`
      const relativePath = `assets/photos/${folder}/${filename}`

      if (mode === 'data-url') {
        cached = { src: await blobToDataUrl(blob) }
      } else {
        const exportImage = { path: relativePath, blob }
        cached = { src: relativePath, image: exportImage }
        images.push(exportImage)
      }
      cache.set(assetId, cached)
    }

    image.setAttribute('src', cached.src)
    image.removeAttribute('data-note-image')
  }

  return { html: container.innerHTML, images }
}

async function waitForImages(container: ParentNode): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'))
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve()
            return
          }
          const done = () => resolve()
          image.addEventListener('load', done, { once: true })
          image.addEventListener('error', done, { once: true })
          window.setTimeout(done, 3000)
        }),
    ),
  )
}

function buildMarkdownFromHtml(html: string, title: string): string {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  })

  service.use(gfm)
  service.addRule('details', {
    filter: (node) => node.nodeName === 'DETAILS',
    replacement: (content) => `\n\n<details>\n\n${content}\n\n</details>\n\n`,
  })
  service.addRule('summary', {
    filter: 'summary',
    replacement: (content) => `<summary>${content}</summary>\n\n`,
  })
  service.addRule('callout', {
    filter: (node) =>
      node.nodeName === 'DIV' && (node as HTMLElement).hasAttribute('data-callout'),
    replacement: (content) => {
      const callout = content.trim()
      if (!callout) return '\n\n> 💡\n\n'

      const lines = callout.split('\n')
      if (lines.length === 1) return `\n\n> 💡 ${lines[0]}\n\n`

      const quoted = lines.map((line) => (line ? `> ${line}` : '>'))
      return `\n\n> 💡\n>\n${quoted.join('\n')}\n\n`
    },
  })

  const container = document.createElement('div')
  container.innerHTML = normalizeExportHtml(html)
  container
    .querySelectorAll('[data-callout] .note-callout-icon')
    .forEach((icon) => icon.remove())

  const body = service.turndown(container.innerHTML).trim()
  return `# ${title.trim() || '未命名文档'}\n\n${body}\n`
}

export async function exportMarkdown(editor: Editor, title: string): Promise<void> {
  const { html } = await hydrateImagesForExport(editor.getHTML(), title, 'data-url')
  const markdown = buildMarkdownFromHtml(html, title)
  downloadBlob(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
    `${safeFileName(title)}.md`,
  )
}

export async function exportMarkdownZip(editor: Editor, title: string): Promise<void> {
  const { html, images } = await hydrateImagesForExport(editor.getHTML(), title, 'files')
  const markdown = buildMarkdownFromHtml(html, title)
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  zip.file(`${safeFileName(title)}.md`, markdown)
  for (const image of images) zip.file(image.path, image.blob)

  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, `${safeFileName(title)}-images.zip`)
}

function ensureExportStyle(): void {
  if (document.getElementById('ainb-export-style')) return
  const style = document.createElement('style')
  style.id = 'ainb-export-style'
  style.textContent = EXPORT_CSS
  document.head.appendChild(style)
}

function buildExportPage(title: string, bodyHtml: string): HTMLDivElement {
  const page = document.createElement('div')
  page.className = 'export-page'

  const heading = document.createElement('h1')
  heading.className = 'export-title'
  heading.textContent = title.trim() || '未命名文档'

  const body = document.createElement('div')
  body.className = 'export-body'
  body.innerHTML = bodyHtml

  page.append(heading, body)
  return page
}

export async function exportPdfDirect(editor: Editor, title: string): Promise<void> {
  ensureExportStyle()

  const { html } = await hydrateImagesForExport(editor.getHTML(), title, 'data-url')
  const page = buildExportPage(title, normalizeExportHtml(html, { keepColgroup: true }))
  page.style.position = 'fixed'
  page.style.left = '20px'
  page.style.top = '0'
  page.style.zIndex = '590'
  page.style.boxShadow = '0 0 0 1px #dddddd'

  const overlay = document.createElement('div')
  overlay.className = 'pdf-busy-overlay'
  overlay.innerHTML = '<div class="pdf-busy"><span class="pdf-spinner"></span><span>正在生成 PDF…</span></div>'

  document.body.append(page, overlay)

  try {
    await new Promise((resolve) => window.setTimeout(resolve, 120))
    await waitForImages(page)

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ])

    const canvas = await html2canvas(page, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 794,
    })

    if (!canvas.height || !canvas.width) throw new Error('导出内容为空')

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()
    const marginX = 12
    const marginY = 10
    const contentWidth = pdfWidth - marginX * 2
    const contentHeight = pdfHeight - marginY * 2
    const pxPerMm = canvas.width / contentWidth
    const sliceHeight = Math.max(1, Math.floor(contentHeight * pxPerMm))

    let offsetY = 0
    let firstPage = true

    while (offsetY < canvas.height) {
      const currentHeight = Math.min(sliceHeight, canvas.height - offsetY)
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = currentHeight

      const context = slice.getContext('2d')
      if (!context) throw new Error('无法创建 PDF 画布')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, slice.width, slice.height)
      context.drawImage(
        canvas,
        0,
        offsetY,
        canvas.width,
        currentHeight,
        0,
        0,
        canvas.width,
        currentHeight,
      )

      if (!firstPage) pdf.addPage()
      pdf.addImage(
        slice.toDataURL('image/jpeg', 0.95),
        'JPEG',
        marginX,
        marginY,
        contentWidth,
        currentHeight / pxPerMm,
      )

      offsetY += sliceHeight
      firstPage = false
    }

    pdf.save(`${safeFileName(title)}.pdf`)
  } finally {
    page.remove()
    overlay.remove()
  }
}

function buildPrintDocument(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtml(title.trim() || '未命名文档')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
${EXPORT_CSS}
@page { size: A4; margin: 16mm; }
html, body { margin: 0; padding: 0; background: #fff; }
.export-page { width: auto; padding: 0; }
.export-title { font-size: 24px; margin-bottom: 18px; }
</style>
</head>
<body>
<main class="export-page">
  <h1 class="export-title">${safeTitle}</h1>
  <div class="export-body">${bodyHtml}</div>
</main>
</body>
</html>`
}

export async function exportPdfPrint(editor: Editor, title: string): Promise<void> {
  const { html: hydratedHtml } = await hydrateImagesForExport(
    editor.getHTML(),
    title,
    'data-url',
  )
  const html = buildPrintDocument(
    title,
    normalizeExportHtml(hydratedHtml, { keepColgroup: true }),
  )
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(iframe)

  const frameDocument = iframe.contentDocument
  if (!frameDocument) {
    iframe.remove()
    return
  }

  frameDocument.open()
  frameDocument.write(html)
  frameDocument.close()

  await new Promise((resolve) => window.setTimeout(resolve, 120))
  await waitForImages(frameDocument.body)

  const frameWindow = iframe.contentWindow
  if (!frameWindow) {
    iframe.remove()
    return
  }

  frameWindow.focus()
  frameWindow.print()
  window.setTimeout(() => iframe.remove(), 2000)
}
