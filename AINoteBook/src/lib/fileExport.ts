import type { Editor } from '@tiptap/core'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { useNoteStore } from '../store/useNoteStore'
import { DOC_TYPE_META, type TreeNode } from '../types'
import { attachmentFolderName, collectEmbeddedDocIds } from './embedRefs'
import { highlightCodeElements } from './codeHighlight'
import { loadBlob } from './db'
import { EXPORT_CSS } from './exportStyles'
import { escapeHtml } from './html'
import { extensionForMime, getAssetMeta, loadAssetBlob } from './imageAssets'
import { docJsonToHtml } from './renderDoc'
import { findAttachmentFolder } from './treeDrag'

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
  flattenDetails?: boolean
  embedPaths?: Map<string, string>
}

function createDetailsBlock(
  summaryHtml: string,
  contentHtml: string,
  flatten: boolean,
): HTMLElement {
  const block = document.createElement(flatten ? 'div' : 'details')
  if (flatten) block.className = 'export-details'
  else (block as HTMLDetailsElement).open = true

  const summary = document.createElement(flatten ? 'div' : 'summary')
  if (flatten) summary.className = 'export-details-summary'
  summary.innerHTML = summaryHtml || '折叠内容'

  const content = document.createElement('div')
  if (flatten) content.className = 'export-details-content'
  content.innerHTML = contentHtml

  block.append(summary, content)
  return block
}

function normalizeDetails(container: HTMLElement, flatten: boolean): void {
  // 当前 schema 直接输出原生 details；从内到外处理，嵌套折叠块也能展开
  Array.from(container.querySelectorAll('details'))
    .reverse()
    .forEach((detailsNode) => {
      const summaryNode = detailsNode.querySelector(':scope > summary')
      const summaryHtml = summaryNode?.innerHTML ?? ''
      const contentHtml = Array.from(detailsNode.children)
        .filter((child) => child !== summaryNode)
        .map((child) => child.outerHTML)
        .join('')
      detailsNode.replaceWith(createDetailsBlock(summaryHtml, contentHtml, flatten))
    })
}

function normalizeExportHtml(
  html: string,
  { keepColgroup = false, flattenDetails = false, embedPaths }: NormalizeExportOptions = {},
): string {
  const container = document.createElement('div')
  container.innerHTML = html

  normalizeDetails(container, flattenDetails)

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

  // 嵌入文档在导出文件里显示为说明卡片；ZIP 导出时附带相对路径标记
  container.querySelectorAll('[data-type="documentEmbed"]').forEach((embed) => {
    const name = embed.getAttribute('data-name') || '嵌入文档'
    const type = embed.getAttribute('data-doc-type')
    const docId = embed.getAttribute('data-doc-id') ?? ''
    const label = type === 'pdf' ? 'PDF' : type === 'docx' ? 'Word' : 'Markdown'
    const path = embedPaths?.get(docId)
    const card = document.createElement('div')
    card.className = 'export-embed'
    if (path) {
      card.setAttribute('data-doc-embed', path)
      card.setAttribute('data-doc-type', type ?? 'md')
      card.setAttribute('data-doc-name', name)
    }
    card.textContent = `📄 嵌入文档：${name}（${label}）`
    embed.replaceWith(card)
  })

  highlightCodeElements(container)

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

function buildMarkdownFromHtml(
  html: string,
  title: string,
  embedPaths?: Map<string, string>,
): string {
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
  service.addRule('embedFile', {
    filter: (node) =>
      node.nodeName === 'DIV' && (node as HTMLElement).hasAttribute('data-doc-embed'),
    replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`,
  })

  const container = document.createElement('div')
  container.innerHTML = normalizeExportHtml(html, { embedPaths })
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

interface AttachmentExport {
  path: string
  blob: Blob
}

interface AttachmentBundle {
  attachments: AttachmentExport[]
  paths: Map<string, string>
}

async function buildAttachmentExports(editor: Editor, title: string): Promise<AttachmentBundle> {
  const docIds = collectEmbeddedDocIds(editor.getJSON())
  const nodes = useNoteStore.getState().nodes
  const active = nodes.find((node) => node.id === useNoteStore.getState().activeId)
  const folder = active ? findAttachmentFolder(nodes, active) : undefined
  const candidates = new Map<string, TreeNode>()

  for (const docId of docIds) {
    const doc = nodes.find((node) => node.id === docId && node.kind === 'doc')
    if (doc) candidates.set(doc.id, doc)
  }
  if (folder) {
    for (const node of nodes) {
      if (node.kind === 'doc' && node.parentId === folder.id) candidates.set(node.id, node)
    }
  }

  const defaultFolder = safeFolderName(attachmentFolderName(title))
  const usedNames = new Set<string>()
  const attachments: AttachmentExport[] = []
  const paths = new Map<string, string>()

  for (const doc of candidates.values()) {
    const parent = nodes.find((node) => node.id === doc.parentId)
    const folderPath = parent?.kind === 'folder' ? safeFolderName(parent.name) : defaultFolder
    const type = doc.docType ?? 'md'
    const meta = DOC_TYPE_META[type]
    const extension = meta.extension
    const base = safeFileName(doc.name) || '嵌入文档'

    let filename = `${base}.${extension}`
    let counter = 2
    while (usedNames.has(filename.toLowerCase())) {
      filename = `${base} (${counter}).${extension}`
      counter += 1
    }
    usedNames.add(filename.toLowerCase())

    let blob: Blob | null = null
    if (type === 'pdf' || type === 'docx') {
      if (!doc.blobId) continue
      const buffer = await loadBlob(doc.blobId)
      if (!buffer) continue
      blob = new Blob([buffer], { type: meta.mime })
    } else {
      const html = docJsonToHtml(doc.content)
      const hydrated = await hydrateImagesForExport(html, doc.name, 'data-url')
      const markdown = buildMarkdownFromHtml(hydrated.html, doc.name)
      blob = new Blob([markdown], { type: `${meta.mime};charset=utf-8` })
    }

    const path = `${folderPath}/${filename}`
    attachments.push({ path, blob })
    paths.set(doc.id, path)
  }

  return { attachments, paths }
}

export async function exportMarkdownZip(editor: Editor, title: string): Promise<void> {
  const { attachments, paths } = await buildAttachmentExports(editor, title)
  const { html, images } = await hydrateImagesForExport(editor.getHTML(), title, 'files')
  const markdown = buildMarkdownFromHtml(html, title, paths)
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  zip.file(`${safeFileName(title)}.md`, markdown)
  for (const image of images) zip.file(image.path, image.blob)
  for (const attachment of attachments) zip.file(attachment.path, attachment.blob)

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

interface BreakBand {
  top: number
  bottom: number
}

const BREAK_ATOM_SELECTOR =
  'img, pre, table tr, blockquote, [data-callout], .export-details, .export-embed'

function mergeBands(bands: BreakBand[]): BreakBand[] {
  const sorted = [...bands].sort((a, b) => a.top - b.top || a.bottom - b.bottom)
  const merged: BreakBand[] = []

  for (const band of sorted) {
    const last = merged[merged.length - 1]
    // 只合并真正重叠的区间；相邻文字行之间保留细缝作为切点
    if (last && band.top < last.bottom - 1) {
      last.bottom = Math.max(last.bottom, band.bottom)
    } else {
      merged.push({ ...band })
    }
  }

  return merged
}

function collectBreakBands(page: HTMLElement, canvas: HTMLCanvasElement): BreakBand[] {
  const pageRect = page.getBoundingClientRect()
  if (pageRect.height <= 0) return []

  const scaleY = canvas.height / pageRect.height
  const bands: BreakBand[] = []

  const addBand = (top: number, bottom: number) => {
    const bandTop = Math.max(0, Math.floor((top - pageRect.top) * scaleY))
    const bandBottom = Math.min(canvas.height, Math.ceil((bottom - pageRect.top) * scaleY))
    if (bandBottom - bandTop >= 2) bands.push({ top: bandTop, bottom: bandBottom })
  }

  page.querySelectorAll(BREAK_ATOM_SELECTOR).forEach((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.height <= 0 || rect.width <= 0) return
    addBand(rect.top, rect.bottom)
  })

  const range = document.createRange()
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.textContent?.trim()) continue

    const parent = node.parentElement
    // 原子块内部文字由块级区间覆盖，不再逐节点测量
    if (!parent || parent.closest(BREAK_ATOM_SELECTOR)) continue

    range.selectNodeContents(node)
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.height <= 0 || rect.width <= 0) continue
      addBand(rect.top, rect.bottom)
    }
  }

  return mergeBands(bands)
}

function findBlockingBand(cut: number, bands: BreakBand[]): BreakBand | null {
  let low = 0
  let high = bands.length - 1

  while (low <= high) {
    const mid = (low + high) >> 1
    const band = bands[mid]
    if (cut <= band.top) high = mid - 1
    else if (cut >= band.bottom) low = mid + 1
    else return cut > band.top + 1 && cut < band.bottom - 1 ? band : null
  }

  return null
}

function findSafeCut(target: number, minCut: number, bands: BreakBand[]): number {
  let cut = target
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const blocking = findBlockingBand(cut, bands)
    if (!blocking) return cut
    const next = blocking.top - 2
    if (next <= minCut) return target
    cut = next
  }
  return target
}

export async function exportPdfDirect(editor: Editor, title: string): Promise<void> {
  ensureExportStyle()

  const { html } = await hydrateImagesForExport(editor.getHTML(), title, 'data-url')
  const page = buildExportPage(
    title,
    normalizeExportHtml(html, { keepColgroup: true, flattenDetails: true }),
  )
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
    const bands = canvas.height > sliceHeight ? collectBreakBands(page, canvas) : []

    let offsetY = 0
    let firstPage = true

    while (offsetY < canvas.height) {
      const target = Math.min(canvas.height, offsetY + sliceHeight)
      const cut = target >= canvas.height ? canvas.height : findSafeCut(target, offsetY + 120, bands)
      const currentHeight = Math.max(1, cut - offsetY)
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

      offsetY = cut
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
    normalizeExportHtml(hydratedHtml, { keepColgroup: true, flattenDetails: true }),
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
