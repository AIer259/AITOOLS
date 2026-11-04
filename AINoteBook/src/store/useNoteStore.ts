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
  planEmptyTrash,
  planEnsureFolder,
  planMoveNode,
  planPlaceEmbeddedDoc,
  planPurgeNode,
  planRestoreNode,
  planTrashNode,
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
  saveNodeContents,
  saveTreeWithContents,
} from '../lib/db'
import {
  invalidateSearchCache,
  removeSearchCache,
  updateSearchCache,
} from '../lib/searchIndex'
import { createSeedData } from '../lib/seed'
import { firstDoc } from '../lib/tree'
import { getTreeIndex } from '../lib/treeIndex'
import {
  isAttachmentFolder,
  type MoveOptions,
  type MoveResult,
  type MoveTarget,
} from '../lib/treeDrag'
import type { DocType, NodeLocation, Theme, TreeNode } from '../types'

export type SaveState = 'idle' | 'saving' | 'saved'

export interface RestoreResult {
  name: string
  reparented: boolean
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
  trashNode: (id: string) => void
  restoreNode: (id: string) => RestoreResult | null
  purgeNode: (id: string) => void
  emptyTrash: () => void
  flushSave: () => Promise<void>
  applyRestored: (nodes: TreeNode[], wrapperIds: string[]) => void
  updateContent: (id: string, content: JSONContent) => void
  toggleExpanded: (id: string) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

let initPromise: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingTree: TreeNode[] | null = null
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

function scheduleSave(set: (partial: Partial<NoteStore>) => void): void {
  set({ saveState: 'saving' })
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushSaveQueue(set)
  }, 350)
}

async function flushSaveQueue(
  set: (partial: Partial<NoteStore>) => void,
  rethrow = false,
): Promise<void> {
  const contents = new Map(pendingContents)
  const tree = pendingTree
  pendingContents.clear()
  pendingTree = null

  try {
    // 只有结构变化才写整棵树；纯输入只写正文与图片引用
    const searchRecords = tree
      ? await saveTreeWithContents(tree, contents)
      : await saveNodeContents(contents)
    updateSearchCache(searchRecords)
    // 保存期间可能又有新输入，只有队列清空才算已保存
    if (pendingContents.size === 0 && !pendingTree) set({ saveState: 'saved' })
  } catch (error) {
    for (const [id, content] of contents) {
      // 不覆盖失败期间新输入的内容
      if (!pendingContents.has(id)) pendingContents.set(id, content)
    }
    if (tree && !pendingTree) pendingTree = tree
    set({ saveState: 'idle' })
    if (rethrow) throw error
  }
}

function queueSave(nodes: TreeNode[], set: (partial: Partial<NoteStore>) => void): void {
  pendingTree = nodes
  scheduleSave(set)
}

function removeStoredContent(nodes: TreeNode[]): void {
  const docIds: string[] = []
  for (const node of nodes) {
    if (node.blobId) void removeBlob(node.blobId)
    if (node.kind === 'doc') {
      pendingContents.delete(node.id)
      docIds.push(node.id)
    }
  }
  if (docIds.length > 0) {
    removeSearchCache(docIds)
    void removeNodeContents(docIds)
  }
}

function createRepository(get: () => NoteStore): NoteRepository {
  return {
    createNode: (input) => {
      const id = get().createNode(input)
      const node = getTreeIndex(get().nodes).byId.get(id)
      if (!node) throw new Error('创建节点失败')
      return node
    },
    findNode: (id) => getTreeIndex(get().nodes).byId.get(id),
    activeLocation: () => {
      const { activeId, nodes } = get()
      const active = getTreeIndex(nodes).byId.get(activeId ?? '')
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
      } catch {
        nodes = createSeedData().nodes
      }

      const index = getTreeIndex(nodes)
      const savedActive = readActiveId()
      const savedNode = savedActive ? index.byId.get(savedActive) : undefined
      activeId =
        savedNode?.kind === 'doc' && !savedNode.deletedAt
          ? savedNode.id
          : (firstDoc(index)?.id ?? null)

      const theme = readTheme()
      applyTheme(theme)
      writeActiveId(activeId)

      const expanded: Record<string, boolean> = {}
      for (const node of nodes) {
        if (node.kind === 'folder') expanded[node.id] = !isAttachmentFolder(node)
      }

      set({ nodes, activeId, theme, expanded, ready: true, saveState: 'saved' })
    })()
    return initPromise
  },

  setActive: (id) => {
    writeActiveId(id)
    set({ activeId: id })

    if (!id) return
    const index = getTreeIndex(get().nodes)
    const expanded = { ...get().expanded }
    let cursor = index.byId.get(id)
    while (cursor?.parentId) {
      expanded[cursor.parentId] = true
      cursor = index.byId.get(cursor.parentId)
    }
    set({ expanded })
  },

  createNode: (input) => {
    const plan = planCreateNode(
      getTreeIndex(get().nodes),
      get().expanded,
      input,
      makeId(),
    )
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
    const plan = planEnsureFolder(
      getTreeIndex(get().nodes),
      get().expanded,
      location,
      name,
      makeId(),
    )
    if (plan.created) {
      set({ nodes: plan.nodes, expanded: plan.expanded })
      queueSave(plan.nodes, set)
    }
    return plan.folder
  },

  ensureAttachmentFolder: (note) => {
    const index = getTreeIndex(get().nodes)
    const current = index.byId.get(note.id) ?? note
    const plan = planAttachmentFolder(index, get().expanded, current, makeId())
    if (plan.nodes !== get().nodes || plan.expanded !== get().expanded) {
      set({ nodes: plan.nodes, expanded: plan.expanded })
      queueSave(plan.nodes, set)
    }
    return plan.folder
  },

  placeEmbeddedDoc: (note, doc) => {
    const index = getTreeIndex(get().nodes)
    const currentNote = index.byId.get(note.id) ?? note
    const currentDoc = index.byId.get(doc.id) ?? doc
    const plan = planPlaceEmbeddedDoc(
      index,
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
    const plan = planMoveNode(
      getTreeIndex(get().nodes),
      get().expanded,
      id,
      target,
      options,
    )
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

  trashNode: (id) => {
    const plan = planTrashNode(getTreeIndex(get().nodes), id)
    if (!plan) return

    let activeId = get().activeId
    if (activeId && plan.trashedIds.has(activeId)) {
      activeId = plan.activeIdFallback
      writeActiveId(activeId)
    }

    set({ nodes: plan.nodes, activeId })
    queueSave(plan.nodes, set)
  },

  restoreNode: (id) => {
    const plan = planRestoreNode(getTreeIndex(get().nodes), id, get().expanded)
    if (!plan) return null

    set({ nodes: plan.nodes, expanded: plan.expanded })
    queueSave(plan.nodes, set)
    return { name: plan.root.name, reparented: plan.reparented }
  },

  purgeNode: (id) => {
    const plan = planPurgeNode(getTreeIndex(get().nodes), id)
    if (!plan) return

    removeStoredContent(plan.removed)
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

  emptyTrash: () => {
    const plan = planEmptyTrash(getTreeIndex(get().nodes))
    if (plan.removed.length === 0) return

    removeStoredContent(plan.removed)
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

  flushSave: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }

    set({ saveState: 'saving' })
    await flushSaveQueue(set, true)
  },

  applyRestored: (nodes, wrapperIds) => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    pendingContents.clear()
    pendingTree = null
    invalidateSearchCache()

    const index = getTreeIndex(nodes)
    let activeId = get().activeId
    if (!activeId || !index.byId.get(activeId)) {
      activeId = index.activeDocs[0]?.id ?? null
    }

    const expanded = { ...get().expanded }
    for (const id of wrapperIds) expanded[id] = true
    for (const node of nodes) {
      if (
        node.kind === 'folder' &&
        node.ownerDocId &&
        expanded[node.id] === undefined
      ) {
        expanded[node.id] = false
      }
    }

    writeActiveId(activeId)
    set({ nodes, activeId, expanded, saveState: 'saved' })
  },

  updateContent: (id, content) => {
    // 正文只进 pending，不改树数组：避免每次输入都重建索引与重渲染侧栏
    pendingContents.set(id, content)
    scheduleSave(set)
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
