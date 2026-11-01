export interface StorageInfo {
  supported: boolean
  usage: number
  quota: number
  persisted: boolean | null
}

let persistPromise: Promise<boolean | null> | null = null

/** 启动时请求持久化存储；同一会话只请求一次 */
export async function ensurePersistentStorage(): Promise<boolean | null> {
  if (persistPromise) return persistPromise

  persistPromise = (async () => {
    if (!navigator.storage?.persist) return null
    try {
      if (navigator.storage.persisted && (await navigator.storage.persisted())) return true
      return await navigator.storage.persist()
    } catch {
      return null
    }
  })()

  return persistPromise
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const persisted = await ensurePersistentStorage()

  if (!navigator.storage?.estimate) {
    return { supported: false, usage: 0, quota: 0, persisted }
  }

  try {
    const estimate = await navigator.storage.estimate()
    return {
      supported: true,
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
      persisted,
    }
  } catch {
    return { supported: false, usage: 0, quota: 0, persisted }
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}
