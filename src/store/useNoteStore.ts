import type { JSONContent } from '@tiptap/core'
import { create } from 'zustand'
import { STORAGE_KEYS } from '../lib/constants'
import { loadTree, removeBlob, saveTree } from '../lib/db'
import { createSeedNodes } from '../lib/seed'
import { firstDoc, getDescendantIds } from '../lib/tree'
import type { Area, DocType, NodeKind, Theme, TreeNode } from '../types'

export type SaveState = 'idle' | 'saving' | 'saved'

interface CreateNodeInput {
  area: Area
  parentId: string | null
  kind: NodeKind
  name: string
  docType?: DocType
  content?: JSONContent
  blobId?: string
  activate?: boolean
}

interface NoteStore {
  nodes: TreeNode[]
  activeId: string | null
  expanded: Record<string, boolean>
  theme: Theme
  ready: boolean
  saveState: SaveState
  init: () => Promise<void>
  setActive: (id: string | null) => void
  createNode: (input: CreateNodeInput) => string
  renameNode: (id: string, name: string) => void
  deleteNode: (id: string) => void
  updateContent: (id: string, content: JSONContent) => void
  toggleExpanded: (id: string) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

let initPromise: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.theme)
    return stored === 'light' || stored === 'dark' ? stored : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

function readActiveId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.active)
  } catch {
    return null
  }
}

function writeActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEYS.active, id)
    else localStorage.removeItem(STORAGE_KEYS.active)
  } catch {
    // 本地存储不可用时忽略
  }
}

function queueSave(nodes: TreeNode[], set: (partial: Partial<NoteStore>) => void): void {
  set({ saveState: 'saving' })
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTree(nodes)
      .then(() => set({ saveState: 'saved' }))
      .catch(() => set({ saveState: 'idle' }))
  }, 350)
}

export const useNoteStore = create<NoteStore>()((set, get) => ({
  nodes: [],
  activeId: null,
  expanded: {},
  theme: readTheme(),
  ready: false,
  saveState: 'idle',

  init: async () => {
    if (initPromise) return initPromise
    initPromise = (async () => {
      let nodes: TreeNode[] = []
      let activeId: string | null = null

      try {
        const stored = await loadTree()
        if (stored && stored.length > 0) {
          nodes = stored
          const savedActive = readActiveId()
          const activeValid = savedActive
            ? nodes.some((node) => node.id === savedActive && node.kind === 'doc')
            : false
          activeId = activeValid ? savedActive : (firstDoc(nodes)?.id ?? null)
        } else {
          nodes = createSeedNodes()
          activeId = firstDoc(nodes)?.id ?? null
          try {
            await saveTree(nodes)
          } catch {
            // 存储不可用时仍允许本次使用
          }
        }
      } catch {
        nodes = createSeedNodes()
        activeId = firstDoc(nodes)?.id ?? null
      }

      const theme = readTheme()
      applyTheme(theme)
      writeActiveId(activeId)

      const expanded: Record<string, boolean> = {}
      for (const node of nodes) {
        if (node.kind === 'folder') expanded[node.id] = true
      }

      set({ nodes, activeId, theme, expanded, ready: true, saveState: 'saved' })
    })()
    return initPromise
  },

  setActive: (id) => {
    writeActiveId(id)
    set({ activeId: id })

    if (!id) return
    const nodes = get().nodes
    const expanded = { ...get().expanded }
    let cursor = nodes.find((node) => node.id === id)
    while (cursor?.parentId) {
      expanded[cursor.parentId] = true
      cursor = nodes.find((node) => node.id === cursor?.parentId)
    }
    set({ expanded })
  },

  createNode: ({ area, parentId, kind, name, docType, content, blobId, activate }) => {
    const fallback = kind === 'doc' ? '未命名文档' : '新建文件夹'
    const finalName = name.trim() || fallback
    const id = makeId()
    const now = Date.now()
    const finalDocType = docType ?? 'md'
    const node: TreeNode = {
      id,
      area,
      parentId,
      kind,
      name: finalName,
      createdAt: now,
      updatedAt: now,
      ...(kind === 'doc'
        ? {
            docType: finalDocType,
            ...(finalDocType === 'md'
              ? { content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] } }
              : {}),
            ...(blobId ? { blobId } : {}),
          }
        : {}),
    }

    const nodes = [...get().nodes, node]
    const expanded = { ...get().expanded }
    if (parentId) expanded[parentId] = true
    if (kind === 'folder') expanded[id] = true

    set({ nodes, expanded })
    if (kind === 'doc' && activate !== false) {
      writeActiveId(id)
      set({ activeId: id })
    }
    queueSave(nodes, set)
    return id
  },

  renameNode: (id, name) => {
    const nodes = get().nodes.map((node) =>
      node.id === id ? { ...node, name, updatedAt: Date.now() } : node,
    )
    set({ nodes })
    queueSave(nodes, set)
  },

  deleteNode: (id) => {
    const nodes = get().nodes
    if (!nodes.some((node) => node.id === id)) return

    const ids = getDescendantIds(nodes, id)
    const removed = nodes.filter((node) => ids.has(node.id))
    const remaining = nodes.filter((node) => !ids.has(node.id))

    for (const node of removed) {
      if (node.blobId) void removeBlob(node.blobId)
    }

    let activeId = get().activeId
    if (activeId && ids.has(activeId)) {
      activeId = firstDoc(remaining)?.id ?? null
      writeActiveId(activeId)
    }

    const expanded = { ...get().expanded }
    for (const removedId of ids) delete expanded[removedId]

    set({ nodes: remaining, activeId, expanded })
    queueSave(remaining, set)
  },

  updateContent: (id, content) => {
    const nodes = get().nodes.map((node) =>
      node.id === id ? { ...node, content, updatedAt: Date.now() } : node,
    )
    set({ nodes })
    queueSave(nodes, set)
  },

  toggleExpanded: (id) => {
    const current = get().expanded[id] ?? true
    set({ expanded: { ...get().expanded, [id]: !current } })
  },

  setTheme: (theme) => {
    applyTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme)
    } catch {
      // 忽略
    }
    set({ theme })
  },

  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark')
  },
}))
