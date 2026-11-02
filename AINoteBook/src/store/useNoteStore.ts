import type { JSONContent } from '@tiptap/core'
import { create } from 'zustand'
import { STORAGE_KEYS } from '../lib/constants'
import { loadTree, removeBlob, saveTree } from '../lib/db'
import { isAttachmentFolderName } from '../lib/embedRefs'
import { createSeedNodes } from '../lib/seed'
import {
  findAttachmentFolder,
  findFlatEmbeddedDocs,
  isAttachmentFolder,
  isEmbeddedNode,
  type MoveOptions,
  type MoveResult,
  type MoveTarget,
} from '../lib/treeDrag'
import { findFolder, firstDoc, getDescendantIds } from '../lib/tree'
import type { Area, DocType, NodeKind, NodeLocation, Theme, TreeNode } from '../types'

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
  expanded?: boolean
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

  createNode: ({
    area,
    parentId,
    kind,
    name,
    docType,
    content,
    blobId,
    activate,
    expanded: expandedOnCreate,
  }) => {
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
    const parentNode = parentId ? get().nodes.find((item) => item.id === parentId) : undefined
    if (parentId && !isAttachmentFolderName(parentNode?.name ?? '')) {
      expanded[parentId] = true
    }
    if (kind === 'folder') expanded[id] = expandedOnCreate ?? true

    set({ nodes, expanded })
    if (kind === 'doc' && activate !== false) {
      writeActiveId(id)
      set({ activeId: id })
    }
    queueSave(nodes, set)
    return id
  },

  moveNodeTo: (id, target, options) => {
    const nodes = get().nodes
    const node = nodes.find((item) => item.id === id)
    if (!node) return 'invalid'

    const targetFolder = target.parentId
      ? nodes.find((item) => item.id === target.parentId)
      : undefined
    if (target.parentId && targetFolder?.kind !== 'folder') return 'invalid'
    if (isAttachmentFolder(nodes, node) || isEmbeddedNode(nodes, node)) return 'invalid'
    if (
      targetFolder &&
      !options?.allowAttachmentTarget &&
      (isAttachmentFolder(nodes, targetFolder) || isEmbeddedNode(nodes, targetFolder))
    ) {
      return 'invalid'
    }

    // 根节点集合：普通节点自身；主文档还包括附件文件夹与平级嵌入文档
    const rootIds = new Set<string>([id])
    if (node.kind === 'doc') {
      const attachmentFolder = findAttachmentFolder(nodes, node)
      if (attachmentFolder) {
        const conflict = findFolder(
          nodes,
          target.area,
          target.parentId,
          attachmentFolder.name,
        )
        if (conflict && conflict.id !== attachmentFolder.id) return 'conflict'
        rootIds.add(attachmentFolder.id)
      }

      for (const embedded of findFlatEmbeddedDocs(nodes, node)) {
        rootIds.add(embedded.id)
      }
    }

    const movingIds = new Set<string>()
    for (const rootId of rootIds) {
      for (const movingId of getDescendantIds(nodes, rootId)) movingIds.add(movingId)
    }

    if (node.kind === 'folder' && target.parentId && movingIds.has(target.parentId)) {
      return 'invalid'
    }

    const now = Date.now()
    const next = nodes.map((item) => {
      if (!movingIds.has(item.id)) return item
      const root = rootIds.has(item.id)
      return {
        ...item,
        area: target.area,
        ...(root ? { parentId: target.parentId } : {}),
        updatedAt: now,
      }
    })

    const expanded = { ...get().expanded }
    if (target.parentId && !isAttachmentFolderName(targetFolder?.name ?? '')) {
      expanded[target.parentId] = true
    }

    set({ nodes: next, expanded })
    queueSave(next, set)
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
    const nodes = get().nodes
    const target = nodes.find((node) => node.id === id)
    if (!target) return

    const ids = getDescendantIds(nodes, id)

    // 删除文档时一并删除它的附件文件夹与仍未迁移的平级嵌入文档
    if (target.kind === 'doc') {
      const folder = findAttachmentFolder(nodes, target)
      if (folder) {
        for (const folderId of getDescendantIds(nodes, folder.id)) ids.add(folderId)
      }

      for (const doc of findFlatEmbeddedDocs(nodes, target)) {
        for (const childId of getDescendantIds(nodes, doc.id)) ids.add(childId)
      }
    }

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

/** 当前活动文档所在位置；没有活动文档时回退到空间根目录 */
export function getActiveLocation(): NodeLocation {
  const { activeId, nodes } = useNoteStore.getState()
  const active = nodes.find((node) => node.id === activeId)
  return {
    area: active?.area ?? 'space',
    parentId: active ? active.parentId : null,
  }
}
