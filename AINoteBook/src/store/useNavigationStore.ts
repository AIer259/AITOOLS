import { create } from 'zustand'
import type { Area } from '../types'
import { useNoteStore } from './useNoteStore'

export interface BrowseTarget {
  area: Area
  folderId: string | null
}

interface NavigationStore {
  browse: BrowseTarget | null
  openArea: (area: Area) => void
  openFolder: (area: Area, folderId: string) => void
  openDocument: (id: string) => void
}

export const useNavigationStore = create<NavigationStore>()((set) => ({
  browse: null,
  openArea: (area) => set({ browse: { area, folderId: null } }),
  openFolder: (area, folderId) => set({ browse: { area, folderId } }),
  openDocument: (id) => {
    useNoteStore.getState().setActive(id)
    set({ browse: null })
  },
}))
