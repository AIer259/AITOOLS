import type { JSONContent } from '@tiptap/core'
import type { LegacyTreeNode } from '../lib/db'
import { attachmentFolderName, collectEmbeddedDocIds } from '../lib/embedRefs'
import { generateKeyBetween } from '../lib/fractionalIndex'
import type { TreeNode } from '../types'

export interface MigratedTree {
  nodes: TreeNode[]
  contents: Map<string, JSONContent>
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 把 v1 的「正文内嵌在树里」迁移为 v2 元数据 + ainb.node.<id> */
export function migrateLegacyTree(legacy: LegacyTreeNode[]): MigratedTree {
  const contents = new Map<string, JSONContent>()
  const nodes: TreeNode[] = legacy.map((node) => {
    const { content, order: _order, ...rest } = node
    if (content) contents.set(node.id, content)
    return { ...rest, order: '' }
  })

  // 旧数据按名称与同级关系找回附件文件夹，补显式关联
  for (const doc of nodes) {
    if (doc.kind !== 'doc') continue

    if (doc.attachmentFolderId) {
      const linked = nodes.find((node) => node.id === doc.attachmentFolderId)
      if (linked?.kind === 'folder') linked.ownerDocId = doc.id
      continue
    }

    const folder = nodes.find(
      (node) =>
        node.kind === 'folder' &&
        node.area === doc.area &&
        node.parentId === doc.parentId &&
        node.name === attachmentFolderName(doc.name),
    )
    if (folder) {
      doc.attachmentFolderId = folder.id
      folder.ownerDocId = doc.id
    }
  }

  // 旧数据里仍与主文件平级的嵌入文档，迁入附件文件夹
  for (const doc of nodes) {
    if (doc.kind !== 'doc') continue
    const content = contents.get(doc.id)
    if (!content) continue

    const flatDocs = collectEmbeddedDocIds(content)
      .map((id) => nodes.find((node) => node.id === id))
      .filter(
        (node): node is TreeNode =>
          Boolean(
            node &&
              node.id !== doc.id &&
              node.kind === 'doc' &&
              node.area === doc.area &&
              node.parentId === doc.parentId,
          ),
      )
    if (flatDocs.length === 0) continue

    let folder = doc.attachmentFolderId
      ? nodes.find((node) => node.id === doc.attachmentFolderId)
      : undefined
    if (!folder) {
      folder = {
        id: makeId(),
        area: doc.area,
        parentId: doc.parentId,
        kind: 'folder',
        name: attachmentFolderName(doc.name),
        order: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      nodes.push(folder)
      doc.attachmentFolderId = folder.id
    }
    folder.ownerDocId = doc.id

    for (const child of flatDocs) {
      child.area = folder.area
      child.parentId = folder.id
      child.updatedAt = Date.now()
    }
  }

  // 按最终数组顺序为每个兄弟组生成 fractional-index
  const groups = new Map<string, TreeNode[]>()
  for (const node of nodes) {
    const key = `${node.area}\u0000${node.parentId ?? ''}`
    const group = groups.get(key)
    if (group) group.push(node)
    else groups.set(key, [node])
  }
  for (const group of groups.values()) {
    let previous: string | null = null
    for (const node of group) {
      node.order = generateKeyBetween(previous, null)
      previous = node.order
    }
  }

  return { nodes, contents }
}
