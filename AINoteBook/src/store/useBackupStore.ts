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
import { createBackupArchive } from '../lib/backupExport'
import {
  restoreBackupArchive,
  type RestoreBackupResult,
} from '../lib/backupRestore'
import { downloadBlob } from '../lib/fileExport'
import { getTreeIndex } from '../lib/treeIndex'
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
  restoreBackup: (file: File) => Promise<RestoreBackupResult | null>
  snooze: () => void
  ignore: () => void
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
    if (get().busy || get().restoring) return

    const note = useNoteStore.getState()
    const docCount = getTreeIndex(note.nodes).activeDocs.length
    const showToast = useUiStore.getState().showToast

    if (docCount === 0) {
      showToast('当前没有可备份的文档', 'info')
      return
    }

    set({ busy: true })
    try {
      await note.flushSave()
      const current = useNoteStore.getState()
      const result = await createBackupArchive({
        nodes: current.nodes,
        readContent: current.readContent,
      })

      downloadBlob(result.blob, result.filename)
      const record = markBackupDone(get().record, result.docCount)
      writeBackupRecord(record)
      set({ record, reason: null, busy: false })
      showToast(
        `备份已导出：${result.docCount} 篇文档、${result.imageCount} 张图片`,
        'success',
      )
      if (result.warnings.length > 0) {
        console.warn('备份警告', result.warnings)
      }
    } catch (error) {
      console.error('备份失败', error)
      set({ busy: false })
      showToast('备份失败，请稍后重试', 'error')
    }
  },

  restoreBackup: async (file) => {
    if (get().restoring || get().busy) return null

    const showToast = useUiStore.getState().showToast
    set({ restoring: true })
    try {
      await useNoteStore.getState().flushSave()
      const current = useNoteStore.getState()
      const result = await restoreBackupArchive(file, current.nodes)
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
  },

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
