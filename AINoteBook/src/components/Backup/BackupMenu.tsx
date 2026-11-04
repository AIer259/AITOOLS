import { Archive, ArchiveRestore } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { formatBackupTime } from '../../lib/backup'
import {
  readBackupSummary,
  restoreFolderLabel,
  type BackupArchiveSummary,
} from '../../lib/backupRestore'
import { useBackupStore } from '../../store/useBackupStore'
import { useUiStore } from '../../store/useUiStore'
import { ConfirmDialog } from '../common/Dialogs'
import { PopupMenu } from '../common/PopupMenu'

interface RestoreCandidate {
  file: File
  summary: BackupArchiveSummary
}

function summaryTime(summary: BackupArchiveSummary): string {
  if (!summary.exportedAt) return '未知'
  const timestamp = new Date(summary.exportedAt).getTime()
  return Number.isNaN(timestamp) ? '未知' : formatBackupTime(timestamp)
}

export function BackupMenu() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [candidate, setCandidate] = useState<RestoreCandidate | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const record = useBackupStore((state) => state.record)
  const busy = useBackupStore((state) => state.busy)
  const restoring = useBackupStore((state) => state.restoring)
  const runBackup = useBackupStore((state) => state.runBackup)
  const restoreBackup = useBackupStore((state) => state.restoreBackup)
  const showToast = useUiStore((state) => state.showToast)

  const disabled = busy || restoring || inspecting

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setInspecting(true)
    try {
      const summary = await readBackupSummary(file)
      if (summary.docs === 0) {
        showToast('备份中没有可恢复的文档', 'error')
        return
      }
      setCandidate({ file, summary })
    } catch (error) {
      console.error('读取备份失败', error)
      showToast(
        error instanceof Error ? error.message : '无法读取备份文件',
        'error',
      )
    } finally {
      setInspecting(false)
    }
  }

  const handleRestore = async () => {
    if (!candidate) return
    const result = await restoreBackup(candidate.file)
    if (result) setCandidate(null)
  }

  const message = candidate
    ? `备份时间：${summaryTime(candidate.summary)}；应用版本：${
        candidate.summary.appVersion
      }。包含 ${candidate.summary.docs} 篇文档、${candidate.summary.folders} 个文件夹、${
        candidate.summary.images
      } 张图片、${candidate.summary.files} 个 PDF/Word 文件。恢复后会放入各分区新建的「${restoreFolderLabel(
        candidate.summary.exportedAt,
      )}」文件夹，现有笔记不受影响。`
    : ''

  const title = record.lastBackupAt
    ? `备份 · 上次备份：${formatBackupTime(record.lastBackupAt)}`
    : '备份 · 尚未备份'

  return (
    <div className="topbar-action-wrap backup-menu">
      <button
        type="button"
        className="icon-button backup-menu-button"
        title={title}
        aria-label="备份"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={disabled}
        onClick={() => setMenuOpen(true)}
      >
        <Archive size={16} />
      </button>
      {menuOpen && (
        <PopupMenu
          className="topbar-menu"
          onClose={() => setMenuOpen(false)}
          items={[
            {
              label: busy ? '正在导出…' : '导出全部笔记',
              icon: <Archive size={14} />,
              onSelect: () => {
                if (!busy) void runBackup()
              },
            },
            {
              label: restoring ? '正在恢复…' : '从备份恢复',
              icon: <ArchiveRestore size={14} />,
              onSelect: () => inputRef.current?.click(),
            },
          ]}
        />
      )}

      <input
        ref={inputRef}
        className="backup-restore-input"
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => void handleFile(event)}
      />

      {candidate && (
        <ConfirmDialog
          title="从备份恢复"
          message={message}
          confirmText={restoring ? '正在恢复…' : '合并恢复'}
          danger={false}
          confirmDisabled={restoring}
          onCancel={() => {
            if (!restoring) setCandidate(null)
          }}
          onConfirm={() => void handleRestore()}
        />
      )}
    </div>
  )
}
