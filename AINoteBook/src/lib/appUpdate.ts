import { STORAGE_KEYS } from './constants'

export const CURRENT_VERSION = __APP_VERSION__
export const CHECK_TIMEOUT_MS = 8000

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value.split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)

  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}

export async function fetchLatestVersion(signal?: AbortSignal): Promise<string | null> {
  const url = new URL(`${import.meta.env.BASE_URL}version.json`, window.location.href)
  url.searchParams.set('t', String(Date.now()))

  const response = await fetch(url, { cache: 'no-store', signal })
  if (!response.ok) return null

  const data = (await response.json()) as unknown
  if (!data || typeof data !== 'object') return null

  const version = (data as { version?: unknown }).version
  return typeof version === 'string' && VERSION_PATTERN.test(version) ? version : null
}

export function reloadToVersion(version: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set('v', version)
  window.location.replace(url)
}

export function clearVersionParam(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('v')) return
  url.searchParams.delete('v')
  window.history.replaceState(null, '', url)
}

export function isVersionSkipped(version: string): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.updateSkipped) === version
  } catch {
    return false
  }
}

export function skipVersion(version: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEYS.updateSkipped, version)
  } catch {
    // 无法写入会话存储时只在本次关闭弹窗
  }
}
