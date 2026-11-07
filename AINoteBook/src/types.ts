export type Area = 'space' | 'private'
export type NodeKind = 'folder' | 'doc'
export type DocType = 'md' | 'docx' | 'pdf' | 'graph'
export type Theme = 'light' | 'dark'

export interface TreeNode {
  id: string
  area: Area
  parentId: string | null
  kind: NodeKind
  name: string
  order: string
  docType?: DocType
  blobId?: string
  /** 文档指向自己的附件文件夹 */
  attachmentFolderId?: string
  /** 附件文件夹指向所属主文档 */
  ownerDocId?: string
  /** 移入回收站的时间；未删除时不存在 */
  deletedAt?: number
  createdAt: number
  updatedAt: number
}

export interface NodeLocation {
  area: Area
  parentId: string | null
}

export const AREA_LABEL: Record<Area, string> = {
  space: '空间',
  private: '私人',
}

export const DOC_TYPE_META: Record<
  DocType,
  { label: string; extension: string; mime: string }
> = {
  md: { label: 'Markdown', extension: 'md', mime: 'text/markdown' },
  docx: {
    label: 'Word',
    extension: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  pdf: { label: 'PDF', extension: 'pdf', mime: 'application/pdf' },
  graph: { label: '关系图', extension: 'md', mime: 'text/markdown' },
}

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  md: DOC_TYPE_META.md.label,
  docx: DOC_TYPE_META.docx.label,
  pdf: DOC_TYPE_META.pdf.label,
  graph: DOC_TYPE_META.graph.label,
}
