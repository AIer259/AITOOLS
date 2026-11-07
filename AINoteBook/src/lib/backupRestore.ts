import type { JSONContent } from '@tiptap/core'
import { DOC_TYPE_META, type Area, type DocType, type TreeNode } from '../types'
import { createBlobId, saveBlob, saveTreeWithContents } from './db'
import { safeFolderName } from './fileExport'
import { normalizeGraphData, type GraphData } from './graph'
import { nextOrder } from './fractionalIndex'
import { restoreImageAsset, type AssetMeta } from './imageAssets'
import { getTreeIndex } from './treeIndex'
import {
  openStreamingZip,
  StreamingUnsupportedError,
  type StreamingZipReader,
} from './zipReader'

interface ManifestNode {
  id: string
  area?: string
  parentId?: string | null
  kind?: string
  name?: string
  order?: string
  docType?: string
  attachmentFolderId?: string
  ownerDocId?: string
  createdAt?: number
  updatedAt?: number
  contentPath?: string
  blobPath?: string
}

interface ManifestAsset {
  id: string
  mime?: string
  path: string
  hash?: string
  width?: number
  height?: number
}

interface BackupManifest {
  format: string
  formatVersion: number
  appVersion?: string
  exportedAt?: string
  nodes: ManifestNode[]
  assets?: ManifestAsset[]
  warnings?: string[]
  counts?: {
    docs?: number
    folders?: number
    images?: number
    files?: number
  }
}

export interface BackupArchiveSummary {
  exportedAt: string | null
  appVersion: string
  docs: number
  folders: number
  images: number
  files: number
  warnings: string[]
}

export interface RestoreBackupResult {
  nodes: TreeNode[]
  wrapperIds: string[]
  wrapperNames: string[]
  docCount: number
  folderCount: number
  imageCount: number
  fileCount: number
  warnings: string[]
}

type BackupReader = Pick<StreamingZipReader, 'readText' | 'readBlob'>

async function openZip(file: File) {
  const JSZip = (await import('jszip')).default
  return JSZip.loadAsync(await file.arrayBuffer())
}

type ZipArchive = Awaited<ReturnType<typeof openZip>>

function zipReader(zip: ZipArchive): BackupReader {
  return {
    readText: async (path) => {
      const entry = zip.file(path)
      return entry ? entry.async('string') : undefined
    },
    readBlob: async (path) => {
      const entry = zip.file(path)
      return entry ? entry.async('blob') : undefined
    },
  }
}

async function readManifest(reader: BackupReader): Promise<BackupManifest> {
  const text = await reader.readText('manifest.json')
  if (text === undefined) {
    throw new Error('不是有效的 AINoteBook 备份：缺少 manifest.json')
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('备份 manifest.json 已损坏')
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('不是有效的 AINoteBook 备份')
  }

  const manifest = raw as Partial<BackupManifest>
  if (
    manifest.format !== 'ainoteBook-backup' ||
    manifest.formatVersion !== 1 ||
    !Array.isArray(manifest.nodes)
  ) {
    throw new Error('备份格式版本不受支持')
  }

  return manifest as BackupManifest
}

async function loadArchive(
  file: File,
): Promise<{ reader: BackupReader; manifest: BackupManifest }> {
  let zip: ZipArchive
  try {
    zip = await openZip(file)
  } catch {
    throw new Error('无法读取备份文件，请确认是完整的 ZIP')
  }

  const reader = zipReader(zip)
  return { reader, manifest: await readManifest(reader) }
}

async function openArchive(
  file: File,
  streaming: boolean,
): Promise<{ reader: BackupReader; manifest: BackupManifest }> {
  if (streaming) {
    try {
      const reader = await openStreamingZip(file)
      return { reader, manifest: await readManifest(reader) }
    } catch (error) {
      if (!(error instanceof StreamingUnsupportedError)) throw error
    }
  }

  return loadArchive(file)
}

function normalizeArea(value: string | undefined): Area {
  return value === 'private' ? 'private' : 'space'
}

function normalizeDocType(value: string | undefined): DocType {
  return value === 'pdf' || value === 'docx' || value === 'graph' ? value : 'md'
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatStamp(value: string | undefined): string {
  const date = value ? new Date(value) : new Date()
  const stamp = Number.isNaN(date.getTime()) ? new Date() : date
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(
    stamp.getDate(),
  )} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`
}

export function restoreFolderLabel(exportedAt?: string | null): string {
  return safeFolderName(`备份恢复 ${formatStamp(exportedAt ?? undefined)}`)
}

function remapEmbedIds(
  content: JSONContent,
  idMap: Map<string, string>,
  warnings: string[],
): void {
  if (content.type === 'documentEmbed' && content.attrs?.docId) {
    const oldId = String(content.attrs.docId)
    const mapped = idMap.get(oldId)
    if (mapped) {
      content.attrs = { ...content.attrs, docId: mapped }
    } else {
      warnings.push(`嵌入文档 ${oldId} 不在备份中`)
    }
  }
  content.content?.forEach((child) => remapEmbedIds(child, idMap, warnings))
}

function summarizeManifest(manifest: BackupManifest): BackupArchiveSummary {
  const nodes = manifest.nodes.filter((node) => node && typeof node.id === 'string')
  const docs = nodes.filter((node) => node.kind !== 'folder')
  const folders = nodes.filter((node) => node.kind === 'folder')
  const files = docs.filter((node) => {
    const type = normalizeDocType(node.docType)
    return type === 'pdf' || type === 'docx'
  })

  return {
    exportedAt: typeof manifest.exportedAt === 'string' ? manifest.exportedAt : null,
    appVersion: typeof manifest.appVersion === 'string' ? manifest.appVersion : '未知',
    docs: manifest.counts?.docs ?? docs.length,
    folders: manifest.counts?.folders ?? folders.length,
    images: manifest.counts?.images ?? manifest.assets?.length ?? 0,
    files: manifest.counts?.files ?? files.length,
    warnings: Array.isArray(manifest.warnings) ? manifest.warnings : [],
  }
}

export async function readBackupSummary(file: File): Promise<BackupArchiveSummary> {
  const { manifest } = await loadArchive(file)
  return summarizeManifest(manifest)
}

/** 只读中央目录与 manifest；不支持流式解压时退回 JSZip */
export async function readBackupSummaryStreaming(
  file: File,
): Promise<BackupArchiveSummary> {
  const { manifest } = await openArchive(file, true)
  return summarizeManifest(manifest)
}

export async function restoreBackupArchive(
  file: File,
  currentNodes: readonly TreeNode[],
): Promise<RestoreBackupResult> {
  const { reader, manifest } = await openArchive(file, false)
  return restoreFromReader(reader, manifest, currentNodes)
}

/** 按条目流式读取；不支持流式解压时退回 JSZip */
export async function restoreBackupArchiveStreaming(
  file: File,
  currentNodes: readonly TreeNode[],
): Promise<RestoreBackupResult> {
  const { reader, manifest } = await openArchive(file, true)
  return restoreFromReader(reader, manifest, currentNodes)
}

async function restoreFromReader(
  reader: BackupReader,
  manifest: BackupManifest,
  currentNodes: readonly TreeNode[],
): Promise<RestoreBackupResult> {
  const now = Date.now()
  const warnings = Array.isArray(manifest.warnings) ? [...manifest.warnings] : []
  const currentIndex = getTreeIndex(currentNodes)

  const sourceNodes = manifest.nodes.filter(
    (node) => node && typeof node.id === 'string' && node.id.length > 0,
  )
  const idMap = new Map<string, string>()
  for (const node of sourceNodes) idMap.set(node.id, newId())

  const rootAreas = new Set<Area>()
  for (const node of sourceNodes) {
    const isRoot = !node.parentId || !idMap.has(node.parentId)
    if (isRoot) rootAreas.add(normalizeArea(node.area))
  }

  const wrappers: TreeNode[] = []
  const wrapperByArea = new Map<Area, string>()
  const wrapperIds: string[] = []
  const wrapperNames: string[] = []

  for (const area of rootAreas) {
    const base = restoreFolderLabel(manifest.exportedAt)
    const existingNames = new Set(
      (currentIndex.roots.get(area) ?? []).map((node) => node.name),
    )
    let name = base
    let counter = 2
    while (existingNames.has(name)) {
      name = `${base} (${counter})`
      counter += 1
    }

    const id = newId()
    const order = nextOrder(
      (currentIndex.roots.get(area) ?? []).map((node) => node.order),
    )
    wrappers.push({
      id,
      area,
      parentId: null,
      kind: 'folder',
      name,
      order,
      createdAt: now,
      updatedAt: now,
    })
    wrapperByArea.set(area, id)
    wrapperIds.push(id)
    wrapperNames.push(name)
  }

  const contents = new Map<string, JSONContent>()
  const restoredNodes: TreeNode[] = []
  let docCount = 0
  let folderCount = 0
  let fileCount = 0

  for (const source of sourceNodes) {
    const id = idMap.get(source.id)
    if (!id) continue

    const area = normalizeArea(source.area)
    const kind = source.kind === 'folder' ? 'folder' : 'doc'
    const parentId =
      source.parentId && idMap.has(source.parentId)
        ? idMap.get(source.parentId) ?? null
        : wrapperByArea.get(area) ?? null

    const node: TreeNode = {
      id,
      area,
      parentId,
      kind,
      name: typeof source.name === 'string' && source.name ? source.name : '未命名',
      order: typeof source.order === 'string' && source.order ? source.order : 'a1',
      createdAt:
        typeof source.createdAt === 'number' ? source.createdAt : now,
      updatedAt: now,
    }

    if (source.attachmentFolderId && idMap.has(source.attachmentFolderId)) {
      node.attachmentFolderId = idMap.get(source.attachmentFolderId)
    }
    if (source.ownerDocId && idMap.has(source.ownerDocId)) {
      node.ownerDocId = idMap.get(source.ownerDocId)
    }

    if (kind === 'folder') {
      folderCount += 1
    } else {
      docCount += 1
      const docType = normalizeDocType(source.docType)
      node.docType = docType

      if (docType === 'md') {
        let content: JSONContent = { type: 'doc', content: [] }
        const text = source.contentPath
          ? await reader.readText(source.contentPath)
          : undefined
        if (text !== undefined) {
          try {
            content = JSON.parse(text) as JSONContent
            remapEmbedIds(content, idMap, warnings)
          } catch {
            warnings.push(`「${node.name}」正文 JSON 损坏，已按空文档恢复`)
          }
        } else {
          warnings.push(`「${node.name}」缺少正文 JSON，已按空文档恢复`)
        }
        contents.set(id, content)
      } else if (docType === 'graph') {
        let graph: GraphData = { nodes: [], edges: [] }
        const text = source.contentPath
          ? await reader.readText(source.contentPath)
          : undefined
        if (text !== undefined) {
          try {
            const parsed = normalizeGraphData(JSON.parse(text))
            graph = {
              nodes: parsed.nodes.map((item) => ({
                ...item,
                docId: idMap.get(item.docId) ?? item.docId,
              })),
              edges: parsed.edges,
            }
          } catch {
            warnings.push(`「${node.name}」关系图数据损坏，已按空关系图恢复`)
          }
        } else {
          warnings.push(`「${node.name}」缺少关系图数据，已按空关系图恢复`)
        }
        contents.set(id, graph as unknown as JSONContent)
      } else {
        fileCount += 1
        const blob = source.blobPath
          ? await reader.readBlob(source.blobPath)
          : undefined
        if (blob) {
          const buffer = await blob.arrayBuffer()
          const blobId = createBlobId()
          await saveBlob(blobId, buffer)
          node.blobId = blobId
        } else {
          warnings.push(`「${node.name}」缺少 ${DOC_TYPE_META[docType].label} 原文件`)
        }
      }
    }

    restoredNodes.push(node)
  }

  let imageCount = 0
  for (const asset of manifest.assets ?? []) {
    if (!asset || typeof asset.id !== 'string' || typeof asset.path !== 'string') {
      continue
    }

    const blob = await reader.readBlob(asset.path)
    if (!blob) {
      warnings.push(`图片 ${asset.id} 缺少文件`)
      continue
    }

    const mime = asset.mime || 'image/png'
    const meta: AssetMeta = {
      id: asset.id,
      hash: asset.hash || asset.id,
      mime,
      width: typeof asset.width === 'number' ? asset.width : 0,
      height: typeof asset.height === 'number' ? asset.height : 0,
      createdAt: now,
      lastUsedAt: now,
    }
    await restoreImageAsset(meta, new Blob([blob], { type: mime }))
    imageCount += 1
  }

  const nodes = [...currentNodes, ...wrappers, ...restoredNodes]
  await saveTreeWithContents(nodes, contents)

  return {
    nodes,
    wrapperIds,
    wrapperNames,
    docCount,
    folderCount,
    imageCount,
    fileCount,
    warnings,
  }
}
