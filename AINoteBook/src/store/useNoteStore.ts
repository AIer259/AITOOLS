import type { JSONContent } from '@tiptap/core'
import { create } from 'zustand'
import {
  importDocument as importDocumentUseCase,
  type ImportDocumentOptions,
  type ImportKind,
} from '../application/importDocument'
import { migrateLegacyTree } from '../application/migrateTree'
import type { NoteRepository } from '../application/noteRepository'
import { uploadDocumentFile as uploadDocumentFileUseCase } from '../application/uploadDocument'
import {
  type CreateNodeInput,
  planAttachmentFolder,
  planCreateNode,
  planDeleteNode,
  planEnsureFolder,
  planMoveNode,
  planPlaceEmbeddedDoc,
} from '../domain/noteOps'
import { STORAGE_KEYS } from '../lib/constants'
import {
  createBlobId,
  loadLegacyTree,
  loadNodeContent,
  loadTree,
  removeBlob,
  removeNodeContents,
  saveBlob,
  saveTreeWithContents,
} from '../lib/db'
import { createSeedData } from '../lib/seed'
import {
  isAttachmentFolder,
  type MoveOptions,
  type MoveResult,
  type MoveTarget,
} from '../lib/treeDrag'
import { firstDoc } from '../lib/tree'
import type { DocType, NodeLocation, Theme, TreeNode } from '../types'

export type SaveState = 'idle' | 'saving' | 'saved'

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
  ensureFolder: (location: NodeLocation, name: string) => TreeNode
  ensureAttachmentFolder: (note: TreeNode) => TreeNode
  placeEmbeddedDoc: (note: TreeNode, doc: TreeNode) => TreeNode
  importDocument: (
    file: File,
    kind: ImportKind,
    options?: ImportDocumentOptions,
  ) => Promise<TreeNode>
  uploadDocumentFile: (
    file: File,
    docType: Exclude<DocType, 'md'>,
    target?: NodeLocation,
  ) => Promise<TreeNode>
  readContent: (id: string) => Promise<JSONContent | undefined>
  moveNodeTo: (id: string, target: MoveTarget, options?: MoveOptions) => MoveResult
  renameNode: (id: string, name: string) => void
  deleteNode: (id: string) => void
  updateContent: (id: string, content: JSONContent) => void
  toggleExpanded: (id: string) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

let initPromise: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const pendingContents = new Map<string, JSONContent>()

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
    const contents = new Map(pendingContents)
    pendingContents.clear()
    saveTreeWithContents(nodes, contents)
      .then(() => set({ saveState: 'saved' }))
      .catch(() => {
        for (const [id, content] of contents) pendingContents.set(id, content)
        set({ saveState: 'idle' })
      })
  }, 350)
}

function createRepository(get: () => NoteStore): NoteRepository {
  return {
    createNode: (input) => {
      const id = get().createNode(input)
      const node = get().nodes.find((item) => item.id === id)
      if (!node) throw new Error('创建节点失败')
      return node
    },
    findNode: (id) => get().nodes.find((item) => item.id === id),
    activeLocation: () => {
      const { activeId, nodes } = get()
      const active = nodes.find((node) => node.id === activeId)
      return {
        area: active?.area ?? 'space',
        parentId: active ? active.parentId : null,
      }
    },
    ensureFolder: (location, name) => get().ensureFolder(location, name),
    ensureAttachmentFolder: (note) => get().ensureAttachmentFolder(note),
    saveBlob: async (data) => {
      const blobId = createBlobId()
      await saveBlob(blobId, data)
      return blobId
    },
  }
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
        let stored = await loadTree()
        if (!stored) {
          const legacy = await loadLegacyTree()
          if (legacy) {
            const migrated = migrateLegacyTree(legacy)
            await saveTreeWithContents(migrated.nodes, migrated.contents)
            stored = migrated.nodes
          } else {
            const seeded = createSeedData()
            await saveTreeWithContents(seeded.nodes, seeded.contents)
            stored = seeded.nodes
          }
        }

        nodes = stored
        const savedActive = readActiveId()
        const activeValid = savedActive
          ? nodes.some((node) => node.id === savedActive && node.kind === 'doc')
          : false
        activeId = activeValid ? savedActive : (firstDoc(nodes)?.id ?? null)
      } catch {
        nodes = createSeedData().nodes
        activeId = firstDoc(nodes)?.id ?? null
      }

      const theme = readTheme()
      applyTheme(theme)
      writeActiveId(activeId)

      const expanded: Record<string, boolean> = {}
      for (const node of nodes) {
        if (node.kind === 'folder') expanded[node.id] = !isAttachmentFolder(nodes, node)
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

  createNode: (input) => {
    const plan = planCreateNode(get().nodes, get().expanded, input, makeId())
    if (plan.content) pendingContents.set(plan.node.id, plan.content)
    set({ nodes: plan.nodes, expanded: plan.expanded })
    if (input.kind === 'doc' && input.activate !== false) {
      writeActiveId(plan.node.id)
      set({ activeId: plan.node.id })
    }
    queueSave(plan.nodes, set)
    return plan.node.id
  },

  ensureFolder: (location, name) => {
    const plan = planEnsureFolder(get().nodes, get().expanded, location, name, makeId())
    if (plan.created) {
      set({ nodes: plan.nodes, expanded: plan.expanded })
      queueSave(plan.nodes, set)
    }
    return plan.folder
  },

  ensureAttachmentFolder: (note) => {
    const current = get().nodes.find((node) => node.id === note.id) ?? note
    const plan = planAttachmentFolder(get().nodes, get().expanded, current, makeId())
    if (plan.nodes !== get().nodes || plan.expanded !== get().expanded) {
      set({ nodes: plan.nodes, expanded: plan.expanded })
      queueSave(plan.nodes, set)
    }
    return plan.folder
  },

  placeEmbeddedDoc: (note, doc) => {
    const currentNote = get().nodes.find((node) => node.id === note.id) ?? note
    const currentDoc = get().nodes.find((node) => node.id === doc.id) ?? doc
    const plan = planPlaceEmbeddedDoc(
      get().nodes,
      get().expanded,
      currentNote,
      currentDoc,
      makeId(),
    )
    if (plan.nodes !== get().nodes || plan.expanded !== get().expanded) {
      set({ nodes: plan.nodes, expanded: plan.expanded })
      queueSave(plan.nodes, set)
    }
    return plan.doc
  },

  importDocument: (file, kind, options) => {
    return importDocumentUseCase(createRepository(get), file, kind, options)
  },

  uploadDocumentFile: (file, docType, target) => {
    return uploadDocumentFileUseCase(createRepository(get), file, docType, target)
  },

  readContent: async (id) => {
    const pending = pendingContents.get(id)
    if (pending) return pending
    return loadNodeContent(id)
  },

  moveNodeTo: (id, target, options) => {
    const plan = planMoveNode(get().nodes, get().expanded, id, target, options)
    if (plan.result !== 'ok') return plan.result

    set({ nodes: plan.nodes, expanded: plan.expanded })
    queueSave(plan.nodes, set)
    return 'ok'
  },

  renameNode: (id, name) => {
    const nodes = get().nodes.map((node) =>
      node.id === id ? { ...node, name, updatedAt: Date.now() } : node,
    )
    set({ nodes })
    queueSave(nodes, set)
  },

  deleteNode: (id) => {
    const plan = planDeleteNode(get().nodes, id)
    if (!plan) return

    const removedDocIds = plan.removed
      .filter((node) => node.kind === 'doc')
      .map((node) => node.id)
    for (const node of plan.removed) {
      if (node.blobId) void removeBlob(node.blobId)
    }
    if (removedDocIds.length > 0) {
      for (const id of removedDocIds) pendingContents.delete(id)
      void removeNodeContents(removedDocIds)
    }

    let activeId = get().activeId
    if (activeId && plan.removedIds.has(activeId)) {
      activeId = plan.activeIdFallback
      writeActiveId(activeId)
    }

    const expanded = { ...get().expanded }
    for (const removedId of plan.removedIds) delete expanded[removedId]

    set({ nodes: plan.remaining, activeId, expanded })
    queueSave(plan.remaining, set)
  },

  updateContent: (id, content) => {
    pendingContents.set(id, content)
    const nodes = get().nodes.map((node) =>
      node.id === id ? { ...node, updatedAt: Date.now() } : node,
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
