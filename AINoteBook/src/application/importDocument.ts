import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { marked } from 'marked'
import { attachmentFolderName } from '../lib/embedRefs'
import { createEditorExtensions } from '../lib/editorExtensions'
import { imageMimeFromName } from '../lib/imageAssets'
import { importMarkdownImages } from '../lib/markdownImages'
import type { NodeLocation, TreeNode } from '../types'
import type { NoteRepository } from './noteRepository'

export type ImportKind = 'md' | 'docx' | 'zip'

export interface ImportDocumentOptions {
  activate?: boolean
  target?: NodeLocation
}

interface ImportedDocument {
  name: string
  content: JSONContent
  attachmentFolderId?: string
}

interface ZipEntry {
  name: string
  async(type: 'string'): Promise<string>
  async(type: 'arraybuffer'): Promise<ArrayBuffer>
}

const ATTACHMENT_EXTENSIONS = /\.(md|markdown|pdf|docx)$/i

function htmlToDocJson(html: string): JSONContent {
  const element = document.createElement('div')
  const editor = new Editor({
    element,
    extensions: createEditorExtensions(),
    content: html,
    editable: false,
  })
  const json = editor.getJSON()
  editor.destroy()
  return json
}

function documentName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || '导入的文档'
}

function normalizeArchivePath(value: string): string {
  let path = value.replace(/\\/g, '/')
  try {
    path = decodeURIComponent(path)
  } catch {
    // 保留原始路径
  }
  return path.replace(/^\.\//, '')
}

function resolveArchivePath(src: string, baseDir: string): string {
  const normalized = normalizeArchivePath(src)
  if (normalized.startsWith('/')) return normalized.slice(1)

  try {
    const url = new URL(normalized, `https://archive.local/${baseDir}`)
    return normalizeArchivePath(url.pathname.replace(/^\//, ''))
  } catch {
    return `${baseDir}${normalized}`
  }
}

/** 把 ZIP 导出的嵌入标记还原为文档节点；找不到文件时降级为说明文字 */
async function importEmbedMarkers(
  html: string,
  resolve: (path: string) => Promise<TreeNode | null>,
): Promise<string> {
  const container = document.createElement('div')
  container.innerHTML = html

  for (const marker of Array.from(container.querySelectorAll<HTMLElement>('[data-doc-embed]'))) {
    const path = marker.getAttribute('data-doc-embed') ?? ''
    const node = path ? await resolve(path) : null

    if (!node) {
      const paragraph = document.createElement('p')
      paragraph.textContent = marker.textContent?.trim() || '📄 嵌入文档'
      marker.replaceWith(paragraph)
      continue
    }

    const embed = document.createElement('div')
    embed.setAttribute('data-type', 'documentEmbed')
    embed.setAttribute('data-doc-id', node.id)
    embed.setAttribute('data-name', node.name)
    embed.setAttribute('data-doc-type', node.docType ?? 'md')
    marker.replaceWith(embed)
  }

  return container.innerHTML
}

async function markdownToContent(
  markdown: string,
  name: string,
  resolveImage: (src: string) => Promise<Blob | null> = async () => null,
  resolveEmbed: (path: string) => Promise<TreeNode | null> = async () => null,
): Promise<JSONContent> {
  const html = await importMarkdownImages(
    marked.parse(markdown, { async: false }),
    name,
    resolveImage,
  )
  return htmlToDocJson(await importEmbedMarkers(html, resolveEmbed))
}

async function importAttachmentEntry(
  entry: ZipEntry,
  path: string,
  name: string,
  parentId: string,
  area: NodeLocation['area'],
  repository: NoteRepository,
): Promise<TreeNode | null> {
  const lower = path.toLowerCase()

  if (lower.endsWith('.pdf') || lower.endsWith('.docx')) {
    const docType = lower.endsWith('.pdf') ? 'pdf' : 'docx'
    const blobId = await repository.saveBlob(await entry.async('arraybuffer'))
    return repository.createNode({
      area,
      parentId,
      kind: 'doc',
      name,
      docType,
      blobId,
      activate: false,
    })
  }

  if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) return null

  const text = await entry.async('string')
  if (!text.trim()) return null

  return repository.createNode({
    area,
    parentId,
    kind: 'doc',
    name,
    content: await markdownToContent(text, name),
    activate: false,
  })
}

async function importMarkdownDocument(file: File): Promise<ImportedDocument> {
  const text = await file.text()
  if (!text.trim()) throw new Error('文件内容为空')

  const name = documentName(file.name)
  return { name, content: await markdownToContent(text, name) }
}

async function importZipDocument(
  file: File,
  location: NodeLocation,
  repository: NoteRepository,
): Promise<ImportedDocument> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const files = Object.values(zip.files).filter((entry) => !entry.dir)

  const markdownEntry = files
    .filter((entry) => /\.(md|markdown)$/i.test(entry.name))
    .sort(
      (a, b) =>
        a.name.split('/').length - b.name.split('/').length || a.name.length - b.name.length,
    )[0]
  if (!markdownEntry) throw new Error('压缩包中找不到 Markdown 文件')

  const text = await markdownEntry.async('string')
  if (!text.trim()) throw new Error('文件内容为空')

  const name = documentName(markdownEntry.name.split('/').pop() ?? '')
  const baseDir = markdownEntry.name.includes('/')
    ? markdownEntry.name.slice(0, markdownEntry.name.lastIndexOf('/') + 1)
    : ''
  const fileMap = new Map(files.map((entry) => [normalizeArchivePath(entry.name), entry]))
  const importedByPath = new Map<string, TreeNode>()

  const attachmentFolder = attachmentFolderName(name)
  const attachmentPrefix = `${resolveArchivePath(attachmentFolder, baseDir)}/`
  let attachmentFolderId: string | null = null
  const getAttachmentFolder = () => {
    if (!attachmentFolderId) {
      attachmentFolderId = repository.ensureFolder(location, attachmentFolder).id
    }
    return attachmentFolderId
  }

  // 先导入附件文件夹内的全部支持文件，即使主笔记没有引用它们
  for (const entry of files) {
    const path = normalizeArchivePath(entry.name)
    if (!path.startsWith(attachmentPrefix) || !ATTACHMENT_EXTENSIONS.test(path)) continue

    const docName = documentName(path.split('/').pop() ?? '')
    const node = await importAttachmentEntry(
      entry,
      path,
      docName,
      getAttachmentFolder(),
      location.area,
      repository,
    )
    if (node) importedByPath.set(path, node)
  }

  const resolveEmbed = async (rawPath: string): Promise<TreeNode | null> => {
    const path = resolveArchivePath(rawPath, baseDir)
    const cached = importedByPath.get(path)
    if (cached) return cached

    const entry = fileMap.get(path)
    if (!entry || !ATTACHMENT_EXTENSIONS.test(path)) return null

    const folderName =
      path.includes('/')
        ? path.slice(0, path.lastIndexOf('/')).split('/').pop() || attachmentFolder
        : attachmentFolder
    const folderId = repository.ensureFolder(location, folderName).id
    const docName = documentName(path.split('/').pop() ?? '')
    const node = await importAttachmentEntry(
      entry,
      path,
      docName,
      folderId,
      location.area,
      repository,
    )
    if (node) importedByPath.set(path, node)
    return node
  }

  const content = await markdownToContent(
    text,
    name,
    async (src) => {
      const entry = fileMap.get(resolveArchivePath(src, baseDir))
      if (!entry) return null
      const buffer = await entry.async('arraybuffer')
      return new Blob([buffer], { type: imageMimeFromName(entry.name) })
    },
    resolveEmbed,
  )
  return {
    name,
    content,
    ...(attachmentFolderId ? { attachmentFolderId } : {}),
  }
}

async function importDocxDocument(file: File): Promise<ImportedDocument> {
  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
  if (!result.value.trim()) throw new Error('文件内容为空')

  return { name: documentName(file.name), content: htmlToDocJson(result.value) }
}

export async function importDocument(
  repository: NoteRepository,
  file: File,
  kind: ImportKind,
  { activate = true, target }: ImportDocumentOptions = {},
): Promise<TreeNode> {
  const location = target ?? repository.activeLocation()

  const imported =
    kind === 'zip'
      ? await importZipDocument(file, location, repository)
      : kind === 'md'
        ? await importMarkdownDocument(file)
        : await importDocxDocument(file)

  const created = repository.createNode({
    area: location.area,
    parentId: location.parentId,
    kind: 'doc',
    name: imported.name,
    content: imported.content,
    activate,
  })

  if (imported.attachmentFolderId) {
    repository.ensureAttachmentFolder(created)
    return repository.findNode(created.id) ?? created
  }

  return created
}
