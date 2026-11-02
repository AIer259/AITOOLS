import type { JSONContent } from '@tiptap/core'

export const ATTACHMENT_SUFFIX = '附件'

export function attachmentFolderName(noteName: string): string {
  return `${noteName.trim() || '未命名文档'}${ATTACHMENT_SUFFIX}`
}

export function isAttachmentFolderName(name: string): boolean {
  return name.endsWith(ATTACHMENT_SUFFIX)
}

export function collectEmbeddedDocIds(content?: JSONContent): string[] {
  const ids = new Set<string>()

  const visit = (node?: JSONContent) => {
    if (!node) return
    if (node.type === 'documentEmbed' && node.attrs?.docId) {
      ids.add(String(node.attrs.docId))
    }
    node.content?.forEach(visit)
  }

  visit(content)
  return [...ids]
}
