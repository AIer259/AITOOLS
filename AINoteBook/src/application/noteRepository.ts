import type { CreateNodeInput } from '../domain/noteOps'
import type { NodeLocation, TreeNode } from '../types'

/** 用例访问笔记数据的抽象；由 store 适配，不直接依赖 Zustand */
export interface NoteRepository {
  createNode: (input: CreateNodeInput) => TreeNode
  findNode: (id: string) => TreeNode | undefined
  activeLocation: () => NodeLocation
  ensureFolder: (location: NodeLocation, name: string) => TreeNode
  ensureAttachmentFolder: (note: TreeNode) => TreeNode
  saveBlob: (data: ArrayBuffer) => Promise<string>
}
