import type { JSONContent } from '@tiptap/core'

export type Area = 'space' | 'private'
export type NodeKind = 'folder' | 'doc'
export type DocType = 'md' | 'docx' | 'pdf'
export type Theme = 'light' | 'dark'

export interface TreeNode {
  id: string
  area: Area
  parentId: string | null
  kind: NodeKind
  name: string
  docType?: DocType
  content?: JSONContent
  blobId?: string
  createdAt: number
  updatedAt: number
}

export const AREA_LABEL: Record<Area, string> = {
  space: '空间',
  private: '私人',
}
