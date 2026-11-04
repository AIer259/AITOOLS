import type { JSONContent } from '@tiptap/core'
import type JSZip from 'jszip'
import { DOC_TYPE_META, type Area, type TreeNode } from '../types'
import { loadBlob, loadNodeContent } from './db'
import { collectEmbeddedDocIds } from './embedRefs'
import {
  buildMarkdownFromHtml,
  createExportAssetCache,
  hydrateImagesForExport,
  safeFileName,
  safeFolderName,
  type ExportImage,
} from './fileExport'
import { extensionForMime } from './imageAssets'
import { docJsonToHtml } from './renderDoc'
import { getTreeIndex } from './treeIndex'

const AREA_DIR: Record<Area, string> = {
  space: '空间',
  private: '私人',
}
const AREA_ORDER: Area[] = ['space', 'private']

export interface BackupArchiveContext {
  nodes: readonly TreeNode[]
  readContent?: (id: string) => Promise<JSONContent | undefined>
}

export interface BackupArchivePlan {
  zip: JSZip
  filename: string
  docCount: number
  folderCount: number
  imageCount: number
  fileCount: number
  warnings: string[]
}

export interface BackupArchiveResult extends Omit<BackupArchivePlan, 'zip'> {
  blob: Blob
}

interface PlannedTree {
  paths: Map<string, string>
  ordered: TreeNode[]
}

interface ManifestNode {
  id: string
  area: Area
  parentId: string | null
  kind: TreeNode['kind']
  name: string
  order: string
  docType?: TreeNode['docType']
  attachmentFolderId?: string
  ownerDocId?: string
  createdAt: number
  updatedAt: number
  path: string
  contentPath?: string
  blobPath?: string
}

function uniquePath(path: string, used: Set<string>, isFile: boolean): string {
  const exists = (value: string) => used.has(value.toLowerCase())
  if (!exists(path)) {
    used.add(path.toLowerCase())
    return path
  }

  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const dot = isFile ? name.lastIndexOf('.') : -1
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''

  for (let counter = 2; ; counter += 1) {
    const candidate = `${dir}${base} (${counter})${extension}`
    if (!exists(candidate)) {
      used.add(candidate.toLowerCase())
      return candidate
    }
  }
}

function planPaths(index: ReturnType<typeof getTreeIndex>): PlannedTree {
  const paths = new Map<string, string>()
  const ordered: TreeNode[] = []
  const used = new Set<string>()

  const visit = (parentId: string | null, dir: string, area: Area) => {
    for (const node of index.activeChildren.get(parentId) ?? []) {
      if (node.area !== area) continue
      ordered.push(node)

      if (node.kind === 'folder') {
        const path = uniquePath(`${dir}/${safeFolderName(node.name)}`, used, false)
        paths.set(node.id, path)
        visit(node.id, path, area)
      } else {
        const meta = DOC_TYPE_META[node.docType ?? 'md']
        const path = uniquePath(
          `${dir}/${safeFileName(node.name)}.${meta.extension}`,
          used,
          true,
        )
        paths.set(node.id, path)
      }
    }
  }

  for (const area of AREA_ORDER) {
    visit(null, `notes/${AREA_DIR[area]}`, area)
  }

  return { paths, ordered }
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(0, slash) : ''
}

function relativePath(fromDir: string, target: string): string {
  const from = fromDir ? fromDir.split('/').filter(Boolean) : []
  const to = target.split('/').filter(Boolean)
  let common = 0
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1
  }

  const up = Array.from({ length: from.length - common }, () => '..')
  return [...up, ...to.slice(common)].join('/')
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`
}

export function backupFileName(date = new Date()): string {
  return `AINoteBook-backup-${stamp(date)}.zip`
}

export async function buildBackupZip(
  context: BackupArchiveContext,
): Promise<BackupArchivePlan> {
  const index = getTreeIndex(context.nodes)
  const { paths, ordered } = planPaths(index)
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const readContent = context.readContent ?? loadNodeContent
  const assetCache = await createExportAssetCache()

  const images = new Map<string, ExportImage>()
  const warnings: string[] = []
  const writtenBlobs = new Set<string>()
  let docCount = 0
  let folderCount = 0
  let fileCount = 0

  for (const node of ordered) {
    if (node.kind === 'folder') {
      folderCount += 1
      const folderPath = paths.get(node.id)
      if (folderPath) zip.folder(folderPath)
      continue
    }

    docCount += 1
    const path = paths.get(node.id)
    if (!path) continue
    const type = node.docType ?? 'md'

    if (type === 'pdf' || type === 'docx') {
      fileCount += 1
      if (!node.blobId) {
        warnings.push(`「${node.name}」缺少原始文件`)
        continue
      }

      const buffer = await loadBlob(node.blobId)
      if (!buffer) {
        warnings.push(`「${node.name}」原始文件读取失败`)
        continue
      }

      zip.file(path, buffer, { compression: 'STORE' })
      writtenBlobs.add(node.id)
      continue
    }

    const content = await readContent(node.id)
    if (!content) warnings.push(`「${node.name}」正文为空或读取失败`)
    const safeContent: JSONContent = content ?? { type: 'doc', content: [] }
    const docDir = dirOf(path)
    const embedPaths = new Map<string, string>()

    for (const docId of collectEmbeddedDocIds(content)) {
      const target = paths.get(docId)
      if (target) embedPaths.set(docId, relativePath(docDir, target))
    }

    const hydrated = await hydrateImagesForExport(
      docJsonToHtml(content),
      node.name,
      'files',
      {
        resolveTarget: (assetId, mime) => {
          const assetPath = `assets/${assetId}.${extensionForMime(mime)}`
          return { src: relativePath(docDir, assetPath), path: assetPath }
        },
        assetCache,
      },
    )

    zip.file(path, buildMarkdownFromHtml(hydrated.html, node.name, embedPaths))
    zip.file(`contents/${node.id}.json`, JSON.stringify(safeContent, null, 2))

    for (const image of hydrated.images) {
      if (!images.has(image.path)) images.set(image.path, image)
    }
  }

  for (const image of images.values()) {
    zip.file(image.path, image.blob, { compression: 'STORE' })
  }

  const manifestNodes: ManifestNode[] = ordered.map((node) => {
    const path = paths.get(node.id) ?? ''
    const type = node.docType ?? 'md'
    return {
      id: node.id,
      area: node.area,
      parentId: node.parentId,
      kind: node.kind,
      name: node.name,
      order: node.order,
      ...(node.docType ? { docType: node.docType } : {}),
      ...(node.attachmentFolderId
        ? { attachmentFolderId: node.attachmentFolderId }
        : {}),
      ...(node.ownerDocId ? { ownerDocId: node.ownerDocId } : {}),
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      path,
      ...(node.kind === 'doc' && type === 'md'
        ? { contentPath: `contents/${node.id}.json` }
        : {}),
      ...(node.kind === 'doc' && writtenBlobs.has(node.id) ? { blobPath: path } : {}),
    }
  })

  const manifest = {
    format: 'ainoteBook-backup',
    formatVersion: 1,
    appVersion: __APP_VERSION__,
    exportedAt: new Date().toISOString(),
    trashIncluded: false,
    areas: AREA_DIR,
    counts: {
      docs: docCount,
      folders: folderCount,
      images: images.size,
      files: fileCount,
    },
    assets: [...images.values()].map((image) => ({
      id: image.assetId ?? image.path,
      mime: image.mime ?? 'application/octet-stream',
      path: image.path,
      hash: image.hash ?? image.assetId ?? '',
      width: image.width ?? 0,
      height: image.height ?? 0,
    })),
    nodes: manifestNodes,
    warnings,
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  return {
    zip,
    filename: backupFileName(),
    docCount,
    folderCount,
    imageCount: images.size,
    fileCount,
    warnings,
  }
}

/** 现有导出方式：在内存生成完整 ZIP 后下载 */
export async function createBackupArchive(
  context: BackupArchiveContext,
): Promise<BackupArchiveResult> {
  const { zip, ...meta } = await buildBackupZip(context)
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  return { blob, ...meta }
}
