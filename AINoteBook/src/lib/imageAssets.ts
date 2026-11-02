import type { JSONContent } from '@tiptap/core'
import { del, get, set } from 'idb-keyval'
import type { TreeNode } from '../types'
import { loadTree } from './db'

export interface AssetMeta {
  id: string
  hash: string
  mime: string
  width: number
  height: number
  createdAt: number
  lastUsedAt: number
}

export interface SavedImage {
  meta: AssetMeta
  path: string
}

export interface SweepResult {
  deleted: number
  kept: number
}

const META_KEY = 'ainb.assets.meta'
const ASSET_PREFIX = 'ainb.asset.'
const ASSET_LOCK = 'ainb.asset.index'
const LOCAL_LOCK_KEY = 'ainb.asset.lock.v1'
const LOCAL_LOCK_TTL = 15_000

export const ASSET_GRACE_MS = 7 * 24 * 60 * 60 * 1000

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
}

const EXT_MIME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime])),
  jpeg: 'image/jpeg',
}

export function extensionForMime(mime: string): string {
  return MIME_EXT[mime] ?? 'png'
}

export function imageMimeFromName(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[extension] ?? 'image/png'
}

export function sanitizePathSegment(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return cleaned || '未命名文档'
}

function buildImagePath(noteName: string, assetId: string, mime: string, timestamp: number): string {
  const folder = sanitizePathSegment(noteName)
  const filename = `${timestamp.toString(36)}-${assetId.slice(0, 8)}.${extensionForMime(mime)}`
  return `assets/photos/${folder}/${filename}`
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) throw new Error('当前环境不支持 SHA-256')
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function getImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return size
    } catch {
      // 回退到 Image 元素
    }
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      resolve({ width: 0, height: 0 })
      URL.revokeObjectURL(url)
    }
    image.src = url
  })
}

function acquireLocalLock(): boolean {
  try {
    const current = Number(localStorage.getItem(LOCAL_LOCK_KEY) ?? 0)
    if (current > Date.now()) return false
    localStorage.setItem(LOCAL_LOCK_KEY, String(Date.now() + LOCAL_LOCK_TTL))
    return true
  } catch {
    return true
  }
}

function releaseLocalLock(): void {
  try {
    localStorage.removeItem(LOCAL_LOCK_KEY)
  } catch {
    // 忽略
  }
}

/**
 * 资源表的读改写使用同一把锁，避免多标签页同时写索引或清理。
 * Chromium 用 navigator.locks；其他环境退化为 localStorage 时间戳锁。
 */
async function withAssetLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(ASSET_LOCK, { mode: 'exclusive' }, () => task())
  }

  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (acquireLocalLock()) {
      try {
        return await task()
      } finally {
        releaseLocalLock()
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  // 锁不可用时仍允许操作，宽限期负责降低误删风险
  return task()
}

export async function loadAssetIndex(): Promise<AssetMeta[]> {
  const value = await get<AssetMeta[]>(META_KEY)
  return Array.isArray(value) ? value : []
}

async function saveAssetIndex(index: AssetMeta[]): Promise<void> {
  await set(META_KEY, index)
}

export async function getAssetMeta(id: string): Promise<AssetMeta | undefined> {
  const index = await loadAssetIndex()
  return index.find((asset) => asset.id === id)
}

export async function loadAssetBlob(id: string): Promise<Blob | undefined> {
  return get<Blob>(ASSET_PREFIX + id)
}

export async function saveImageAsset(file: Blob, noteName: string): Promise<SavedImage> {
  if (!file.type.startsWith('image/')) throw new Error('不是图片文件')

  const buffer = await file.arrayBuffer()
  const hash = await sha256Hex(buffer)
  const mime = file.type || 'image/png'
  const size = await getImageSize(file)
  const now = Date.now()
  const blob = new Blob([buffer], { type: mime })

  return withAssetLock(async () => {
    const index = await loadAssetIndex()
    const existing = index.find((asset) => asset.id === hash)

    if (existing) {
      const updated: AssetMeta = { ...existing, lastUsedAt: now }
      await saveAssetIndex(index.map((asset) => (asset.id === hash ? updated : asset)))
      return { meta: updated, path: buildImagePath(noteName, hash, existing.mime || mime, now) }
    }

    const meta: AssetMeta = {
      id: hash,
      hash,
      mime,
      width: size.width,
      height: size.height,
      createdAt: now,
      lastUsedAt: now,
    }
    await set(ASSET_PREFIX + hash, blob)
    await saveAssetIndex([...index, meta])
    return { meta, path: buildImagePath(noteName, hash, mime, now) }
  })
}

export function collectImageFiles(data: DataTransfer | null): File[] {
  if (!data) return []

  const files = Array.from(data.files ?? []).filter((file) => file.type.startsWith('image/'))
  if (files.length > 0) return files

  return Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

export function collectReferencedAssetIds(nodes: TreeNode[]): Set<string> {
  const ids = new Set<string>()

  const visit = (content: JSONContent | undefined) => {
    if (!content) return
    if (content.type === 'noteImage' && content.attrs?.assetId) {
      ids.add(String(content.attrs.assetId))
    }
    content.content?.forEach(visit)
  }

  for (const node of nodes) {
    if (node.kind === 'doc' && node.content) visit(node.content)
  }

  return ids
}

export async function sweepUnusedAssets(graceMs = ASSET_GRACE_MS): Promise<SweepResult> {
  return withAssetLock(async () => {
    const [nodes, index] = await Promise.all([loadTree(), loadAssetIndex()])
    const referenced = collectReferencedAssetIds(nodes ?? [])
    const now = Date.now()
    const candidates = index.filter(
      (asset) => !referenced.has(asset.id) && now - asset.lastUsedAt > graceMs,
    )

    for (const asset of candidates) {
      await del(ASSET_PREFIX + asset.id)
    }

    const deletedIds = new Set(candidates.map((asset) => asset.id))
    const remaining = index.filter((asset) => !deletedIds.has(asset.id))
    if (candidates.length > 0) await saveAssetIndex(remaining)

    return { deleted: candidates.length, kept: remaining.length }
  })
}

/** 把只读 HTML 里带 data-asset-id 的图片换成 object URL，返回清理函数 */
export async function hydrateImageElements(container: HTMLElement): Promise<() => void> {
  const urls: string[] = []
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('img[data-asset-id]'))

  for (const image of images) {
    const id = image.getAttribute('data-asset-id')
    if (!id || image.src) continue
    const blob = await loadAssetBlob(id)
    if (!blob) continue
    const url = URL.createObjectURL(blob)
    urls.push(url)
    image.src = url
  }

  return () => {
    for (const url of urls) URL.revokeObjectURL(url)
  }
}
