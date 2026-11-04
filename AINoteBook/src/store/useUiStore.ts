import type { Editor } from '@tiptap/core'
import { create } from 'zustand'
import {
  clampSidebarWidth,
  readSidebarLayout,
  saveSidebarLayout,
} from '../lib/sidebarLayout'
import { getStorageInfo, type StorageInfo } from '../lib/storageInfo'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

interface UiStore {
  editor: Editor | null
  contentReadyId: string | null
  tocOpen: boolean
  searchOpen: boolean
  globalSearchOpen: boolean
  pendingSearch: { docId: string; query: string } | null
  embedPickerOpen: boolean
  embedInsertPos: number | null
  storageInfo: StorageInfo | null
  toasts: ToastItem[]
  sidebarOpen: boolean
  sidebarWidth: number
  setEditor: (editor: Editor | null) => void
  setContentReadyId: (id: string | null) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  toggleToc: () => void
  setSearchOpen: (open: boolean) => void
  openGlobalSearch: () => void
  closeGlobalSearch: () => void
  requestSearch: (docId: string, query: string) => void
  clearPendingSearch: () => void
  openEmbedPicker: (pos: number) => void
  closeEmbedPicker: () => void
  refreshStorage: () => Promise<void>
  showToast: (message: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
}

let toastId = 0
const initialSidebar = readSidebarLayout()

export const useUiStore = create<UiStore>()((set) => ({
  editor: null,
  contentReadyId: null,
  tocOpen: false,
  searchOpen: false,
  globalSearchOpen: false,
  pendingSearch: null,
  embedPickerOpen: false,
  embedInsertPos: null,
  storageInfo: null,
  toasts: [],
  sidebarOpen: initialSidebar.open,
  sidebarWidth: initialSidebar.width,

  setEditor: (editor) => set({ editor }),

  setContentReadyId: (id) => set({ contentReadyId: id }),

  toggleSidebar: () =>
    set((state) => {
      const open = !state.sidebarOpen
      saveSidebarLayout({ open, width: state.sidebarWidth })
      return { sidebarOpen: open }
    }),

  setSidebarWidth: (width) =>
    set((state) => {
      const next = clampSidebarWidth(width)
      saveSidebarLayout({ open: state.sidebarOpen, width: next })
      return { sidebarWidth: next }
    }),

  toggleToc: () => set((state) => ({ tocOpen: !state.tocOpen })),

  setSearchOpen: (open) => set({ searchOpen: open }),

  openGlobalSearch: () => set({ globalSearchOpen: true, searchOpen: false }),

  closeGlobalSearch: () => set({ globalSearchOpen: false }),

  requestSearch: (docId, query) =>
    set({
      globalSearchOpen: false,
      searchOpen: true,
      pendingSearch: { docId, query },
    }),

  clearPendingSearch: () => set({ pendingSearch: null }),

  openEmbedPicker: (pos) => set({ embedPickerOpen: true, embedInsertPos: pos }),

  closeEmbedPicker: () => set({ embedPickerOpen: false, embedInsertPos: null }),

  refreshStorage: async () => {
    const info = await getStorageInfo()
    set({ storageInfo: info })
  },

  showToast: (message, kind = 'info') => {
    toastId += 1
    const id = toastId
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }))
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
    }, 3200)
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },
}))
