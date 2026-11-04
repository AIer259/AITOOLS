import { downloadBlob } from './fileExport'
import type { ZipSink } from './zipStream'

export type BackupSinkKind = 'file' | 'opfs' | 'blob'

export interface BackupSinkHandle {
  kind: BackupSinkKind
  sink: ZipSink
  /** 写入关闭后的收尾：直接写盘无操作，OPFS / Blob 触发下载 */
  deliver: () => Promise<void>
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}

type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>

const OPFS_PREFIX = '.ainb-backup-'
const OPFS_CLEANUP_MS = 5000

function getSaveFilePicker(): SaveFilePicker | null {
  const picker = (
    window as Window & { showSaveFilePicker?: SaveFilePicker }
  ).showSaveFilePicker
  return typeof picker === 'function' ? picker : null
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === 'AbortError'
  )
}


type FileSinkResult =
  | { status: 'ok'; handle: BackupSinkHandle }
  | { status: 'canceled' }
  | { status: 'unavailable' }

async function openFileSink(filename: string): Promise<FileSinkResult> {
  const picker = getSaveFilePicker()
  if (!picker) return { status: 'unavailable' }

  try {
    const handle = await picker({
      suggestedName: filename,
      types: [
        {
          description: 'AINoteBook 备份',
          accept: { 'application/zip': ['.zip'] },
        },
      ],
    })
    const writable = await handle.createWritable()

    return {
      status: 'ok',
      handle: {
        kind: 'file',
        sink: {
          write: (chunk) =>
            writable.write(chunk as unknown as FileSystemWriteChunkType),
          close: () => writable.close(),
          abort: async () => {
            try {
              await writable.abort()
            } catch {
              // 可能已经关闭
            }
          },
        },
        deliver: async () => undefined,
      },
    }
  } catch (error) {
    // 用户取消选择时不再回退；其他失败再尝试回退方案
    if (isAbortError(error)) return { status: 'canceled' }
    console.warn('直接写盘不可用，改用回退方案', error)
    return { status: 'unavailable' }
  }
}

async function openOpfsSink(filename: string): Promise<BackupSinkHandle> {
  if (typeof navigator.storage?.getDirectory !== 'function') {
    throw new Error('OPFS 不可用')
  }

  const root = await navigator.storage.getDirectory()
  const tempName = `${OPFS_PREFIX}${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.zip`
  const handle = await root.getFileHandle(tempName, { create: true })
  const writable = await handle.createWritable()
  let cleaned = false

  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    try {
      await root.removeEntry(tempName)
    } catch {
      // 清理失败不影响已完成的下载
    }
  }

  return {
    kind: 'opfs',
    sink: {
      write: (chunk) =>
        writable.write(chunk as unknown as FileSystemWriteChunkType),
      close: () => writable.close(),
      abort: async () => {
        try {
          await writable.abort()
        } catch {
          // 可能已经关闭
        }
        await cleanup()
      },
    },
    deliver: async () => {
      const file = await handle.getFile()
      downloadBlob(file, filename, 60000)
      window.setTimeout(() => {
        void cleanup()
      }, OPFS_CLEANUP_MS)
    },
  }
}

function openBlobSink(filename: string): BackupSinkHandle {
  const chunks: Uint8Array[] = []

  return {
    kind: 'blob',
    sink: {
      write: async (chunk) => {
        chunks.push(chunk)
      },
      close: async () => undefined,
      abort: async () => {
        chunks.length = 0
      },
    },
    deliver: async () => {
      downloadBlob(new Blob(chunks as BlobPart[], { type: 'application/zip' }), filename)
    },
  }
}

/**
 * 选择流式备份的输出目标：
 * 1. File System Access 直接写盘
 * 2. OPFS 暂存后下载
 * 3. 内存 Blob 下载兜底
 * 用户取消保存选择时返回 null。
 */
export async function openBackupSink(
  filename: string,
): Promise<BackupSinkHandle | null> {
  const fileSink = await openFileSink(filename)
  if (fileSink.status === 'ok') return fileSink.handle
  if (fileSink.status === 'canceled') return null

  try {
    return await openOpfsSink(filename)
  } catch (error) {
    console.warn('OPFS 暂存不可用，改用内存下载', error)
    return openBlobSink(filename)
  }
}
