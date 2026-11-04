import { create } from 'zustand'
import type { Area } from '../types'
import { useNoteStore } from './useNoteStore'

export interface BrowseTarget {
  area: Area
  folderId: string | null
}

interface NavigationStore {
  browse: BrowseTarget | null
  trashOpen: boolean
  openTrash: () => void
  openArea: (area: Area) => void
  openFolder: (area: Area, folderId: string) => void
  openDocument: (id: string) => void
}

export const useNavigationStore = create<NavigationStore>()((set) => ({
  browse: null,
  trashOpen: false,
  openTrash: () => set({ browse: null, trashOpen: true }),
  openArea: (area) => set({ browse: { area, folderId: null }, trashOpen: false }),
  openFolder: (area, folderId) =>
    set({ browse: { area, folderId }, trashOpen: false }),
  openDocument: (id) => {
    useNoteStore.getState().setActive(id)
    set({ browse: null, trashOpen: false })
  },
}))
