import { STORAGE_KEYS } from './constants'

export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480
export const SIDEBAR_DEFAULT_WIDTH = 260

export interface SidebarLayout {
  open: boolean
  width: number
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

export function applySidebarWidth(width: number): void {
  document.documentElement.style.setProperty('--sidebar-width', `${clampSidebarWidth(width)}px`)
}

export function readSidebarLayout(): SidebarLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.sidebar)
    if (!raw) return { open: true, width: SIDEBAR_DEFAULT_WIDTH }

    const parsed = JSON.parse(raw) as Partial<SidebarLayout>
    return {
      open: parsed.open !== false,
      width: clampSidebarWidth(
        typeof parsed.width === 'number' ? parsed.width : SIDEBAR_DEFAULT_WIDTH,
      ),
    }
  } catch {
    return { open: true, width: SIDEBAR_DEFAULT_WIDTH }
  }
}

export function saveSidebarLayout(layout: SidebarLayout): void {
  try {
    localStorage.setItem(STORAGE_KEYS.sidebar, JSON.stringify(layout))
  } catch {
    // 存储不可用时忽略，布局仅在本次会话生效
  }
}
