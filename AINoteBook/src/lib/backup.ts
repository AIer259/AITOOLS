import { STORAGE_KEYS } from './constants'

export const BACKUP_STALE_MS = 30 * 24 * 60 * 60 * 1000
export const BACKUP_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000
export const BACKUP_CHANGE_THRESHOLD = 10

export interface BackupRecord {
  lastBackupAt: number | null
  lastBackupDocCount: number
  ignored: boolean
  snoozedUntil: number | null
}

export type BackupReminderReason = 'never' | 'stale' | 'changes'

export const DEFAULT_BACKUP_RECORD: BackupRecord = {
  lastBackupAt: null,
  lastBackupDocCount: 0,
  ignored: false,
  snoozedUntil: null,
}

export function readBackupRecord(): BackupRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.backup)
    if (!raw) return { ...DEFAULT_BACKUP_RECORD }

    const parsed = JSON.parse(raw) as Partial<BackupRecord>
    return {
      lastBackupAt:
        typeof parsed.lastBackupAt === 'number' && Number.isFinite(parsed.lastBackupAt)
          ? parsed.lastBackupAt
          : null,
      lastBackupDocCount:
        typeof parsed.lastBackupDocCount === 'number' &&
        Number.isFinite(parsed.lastBackupDocCount) &&
        parsed.lastBackupDocCount >= 0
          ? parsed.lastBackupDocCount
          : 0,
      ignored: parsed.ignored === true,
      snoozedUntil:
        typeof parsed.snoozedUntil === 'number' && Number.isFinite(parsed.snoozedUntil)
          ? parsed.snoozedUntil
          : null,
    }
  } catch {
    return { ...DEFAULT_BACKUP_RECORD }
  }
}

export function writeBackupRecord(record: BackupRecord): void {
  try {
    localStorage.setItem(STORAGE_KEYS.backup, JSON.stringify(record))
  } catch {
    // 本地存储不可用时忽略
  }
}

export function getBackupReminder(
  record: BackupRecord,
  docCount: number,
  now = Date.now(),
): BackupReminderReason | null {
  if (docCount <= 0 || record.ignored) return null
  if (record.snoozedUntil && record.snoozedUntil > now) return null
  if (record.lastBackupAt === null) return 'never'
  if (now - record.lastBackupAt >= BACKUP_STALE_MS) return 'stale'
  if (Math.abs(docCount - record.lastBackupDocCount) >= BACKUP_CHANGE_THRESHOLD) {
    return 'changes'
  }
  return null
}

export function markBackupDone(
  record: BackupRecord,
  docCount: number,
  now = Date.now(),
): BackupRecord {
  return {
    ...record,
    lastBackupAt: now,
    lastBackupDocCount: docCount,
    snoozedUntil: null,
  }
}

export function snoozeBackup(
  record: BackupRecord,
  now = Date.now(),
): BackupRecord {
  return {
    ...record,
    snoozedUntil: now + BACKUP_SNOOZE_MS,
  }
}

export function ignoreBackup(record: BackupRecord): BackupRecord {
  return { ...record, ignored: true }
}

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatBackupTime(timestamp: number | null): string {
  return timestamp ? timeFormatter.format(timestamp) : '从未备份'
}
