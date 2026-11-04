import { Archive } from 'lucide-react'
import { formatBackupTime } from '../../lib/backup'
import { useBackupStore } from '../../store/useBackupStore'
import { useTreeIndex } from '../../store/useTreeIndex'

export function BackupBanner() {
  const reason = useBackupStore((state) => state.reason)
  const record = useBackupStore((state) => state.record)
  const busy = useBackupStore((state) => state.busy)
  const runBackup = useBackupStore((state) => state.runBackup)
  const snooze = useBackupStore((state) => state.snooze)
  const ignore = useBackupStore((state) => state.ignore)
  const index = useTreeIndex()

  if (!reason) return null

  const title =
    reason === 'never'
      ? '尚未备份笔记'
      : reason === 'stale'
        ? '备份已过期'
        : '文档变化较多'

  const message =
    reason === 'never'
      ? '导出一份完整 ZIP，可防止浏览器数据被清理、换电脑或磁盘故障时丢失。'
      : reason === 'stale'
        ? `上次备份于 ${formatBackupTime(record.lastBackupAt)}，建议导出最新备份。`
        : `上次备份 ${record.lastBackupDocCount} 篇，当前 ${index.activeDocs.length} 篇，建议更新备份。`

  return (
    <div className="backup-banner" role="status" aria-live="polite">
      <span className="backup-banner-icon">
        <Archive size={18} />
      </span>
      <span className="backup-banner-text">
        <strong>{title}</strong>
        <span>{message}</span>
      </span>
      <span className="backup-banner-actions">
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => void runBackup()}
        >
          {busy ? '正在备份…' : '立即备份'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={snooze}>
          7 天后再提醒
        </button>
        <button type="button" className="backup-ignore" onClick={ignore}>
          不再提醒
        </button>
      </span>
    </div>
  )
}
