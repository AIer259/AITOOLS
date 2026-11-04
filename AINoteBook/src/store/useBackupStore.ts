import { create } from 'zustand'
import {
  getBackupReminder,
  ignoreBackup,
  markBackupDone,
  readBackupRecord,
  snoozeBackup,
  writeBackupRecord,
  type BackupRecord,
  type BackupReminderReason,
} from '../lib/backup'
import {
  backupFileName,
  buildBackupZip,
  createBackupArchive,
} from '../lib/backupExport'
import { openBackupSink, type BackupSinkHandle } from '../lib/backupSink'
import {
  restoreBackupArchive,
  restoreBackupArchiveStreaming,
  type RestoreBackupResult,
} from '../lib/backupRestore'
import { downloadBlob } from '../lib/fileExport'
import { writeZipStream } from '../lib/zipStream'
import { getTreeIndex } from '../lib/treeIndex'
import type { TreeNode } from '../types'
import { useNoteStore } from './useNoteStore'
import { useUiStore } from './useUiStore'

interface BackupStore {
  record: BackupRecord
  reason: BackupReminderReason | null
  busy: boolean
  restoring: boolean
  initialized: boolean
  init: () => void
  runBackup: () => Promise<void>
  runStreamingBackup: () => Promise<void>
  restoreBackup: (file: File) => Promise<RestoreBackupResult | null>
  restoreStreamingBackup: (file: File) => Promise<RestoreBackupResult | null>
  snooze: () => void
  ignore: () => void
}

type BackupSet = (partial: Partial<BackupStore>) => void
type BackupGet = () => BackupStore
type RestoreFn = (
  file: File,
  nodes: readonly TreeNode[],
) => Promise<RestoreBackupResult>

function canStartBackup(get: BackupGet): boolean {
  if (get().busy || get().restoring) return false
  const docCount = getTreeIndex(useNoteStore.getState().nodes).activeDocs.length
  if (docCount === 0) {
    useUiStore.getState().showToast('当前没有可备份的文档', 'info')
    return false
  }
  return true
}

function completeBackup(
  summary: { docCount: number; imageCount: number; warnings: string[] },
  set: BackupSet,
  get: BackupGet,
  message: string,
): void {
  const record = markBackupDone(get().record, summary.docCount)
  writeBackupRecord(record)
  set({ record, reason: null, busy: false })
  useUiStore.getState().showToast(message, 'success')
  if (summary.warnings.length > 0) {
    console.warn('备份警告', summary.warnings)
  }
}

async function runRestore(
  file: File,
  restore: RestoreFn,
  set: BackupSet,
  get: BackupGet,
): Promise<RestoreBackupResult | null> {
  if (get().restoring || get().busy) return null

  const showToast = useUiStore.getState().showToast
  set({ restoring: true })
  try {
    await useNoteStore.getState().flushSave()
    const current = useNoteStore.getState()
    const result = await restore(file, current.nodes)
    useNoteStore.getState().applyRestored(result.nodes, result.wrapperIds)
    set({ restoring: false })
    showToast(
      result.wrapperNames.length > 0
        ? `已恢复 ${result.docCount} 篇文档到「${result.wrapperNames.join('、')}」`
        : '备份中没有可恢复的文档',
      'success',
    )
    if (result.warnings.length > 0) {
      console.warn('恢复警告', result.warnings)
    }
    return result
  } catch (error) {
    console.error('恢复备份失败', error)
    set({ restoring: false })
    showToast(
      error instanceof Error ? error.message : '恢复失败，请确认备份文件完整',
      'error',
    )
    return null
  }
}

export const useBackupStore = create<BackupStore>()((set, get) => ({
  record: readBackupRecord(),
  reason: null,
  busy: false,
  restoring: false,
  initialized: false,

  init: () => {
    if (get().initialized) return

    const index = getTreeIndex(useNoteStore.getState().nodes)
    const reason = getBackupReminder(get().record, index.activeDocs.length)
    set({ initialized: true, reason })
  },

  runBackup: async () => {
    if (!canStartBackup(get)) return

    const note = useNoteStore.getState()
    const showToast = useUiStore.getState().showToast
    set({ busy: true })
    try {
      await note.flushSave()
      const current = useNoteStore.getState()
      const result = await createBackupArchive({
        nodes: current.nodes,
        readContent: current.readContent,
      })

      downloadBlob(result.blob, result.filename)
      completeBackup(
        result,
        set,
        get,
        `备份已导出：${result.docCount} 篇文档、${result.imageCount} 张图片`,
      )
    } catch (error) {
      console.error('备份失败', error)
      set({ busy: false })
      showToast('备份失败，请稍后重试', 'error')
    }
  },

  runStreamingBackup: async () => {
    if (!canStartBackup(get)) return

    const note = useNoteStore.getState()
    const showToast = useUiStore.getState().showToast
    const filename = backupFileName()
    set({ busy: true })
    let target: BackupSinkHandle | null = null

    try {
      // 先选保存位置：必须在用户手势内调用 showSaveFilePicker
      target = await openBackupSink(filename)
      if (!target) {
        set({ busy: false })
        return
      }

      await note.flushSave()
      const current = useNoteStore.getState()
      const plan = await buildBackupZip({
        nodes: current.nodes,
        readContent: current.readContent,
      })

      await writeZipStream(plan.zip, target.sink)
      await target.sink.close()
      await target.deliver()

      completeBackup(
        plan,
        set,
        get,
        `流式备份完成：${plan.docCount} 篇文档、${plan.imageCount} 张图片，${
          target.kind === 'file' ? '已写入所选文件' : '已通过浏览器下载'
        }`,
      )
    } catch (error) {
      console.error('流式备份失败', error)
      if (target) await target.sink.abort()
      set({ busy: false })
      showToast('流式备份失败，请稍后重试', 'error')
    }
  },

  restoreBackup: (file) => runRestore(file, restoreBackupArchive, set, get),

  restoreStreamingBackup: (file) =>
    runRestore(file, restoreBackupArchiveStreaming, set, get),

  snooze: () => {
    const record = snoozeBackup(get().record)
    writeBackupRecord(record)
    set({ record, reason: null })
  },

  ignore: () => {
    const record = ignoreBackup(get().record)
    writeBackupRecord(record)
    set({ record, reason: null })
  },
}))
