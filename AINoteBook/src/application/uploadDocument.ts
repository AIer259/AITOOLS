import { DOC_TYPE_LABEL, type DocType, type NodeLocation, type TreeNode } from '../types'
import type { NoteRepository } from './noteRepository'

type DocumentUploadType = Exclude<DocType, 'md'>

export async function uploadDocumentFile(
  repository: NoteRepository,
  file: File,
  docType: DocumentUploadType,
  target?: NodeLocation,
): Promise<TreeNode> {
  const blobId = await repository.saveBlob(await file.arrayBuffer())
  const name = file.name.replace(/\.[^.]+$/, '').trim() || `${DOC_TYPE_LABEL[docType]} 文档`
  const location = target ?? repository.activeLocation()

  return repository.createNode({
    area: location.area,
    parentId: location.parentId,
    kind: 'doc',
    name,
    docType,
    blobId,
    activate: false,
  })
}
