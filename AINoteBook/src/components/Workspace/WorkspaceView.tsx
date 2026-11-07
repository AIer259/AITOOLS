import { FilePlus2, Folder, FolderPlus, Network } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigationStore } from '../../store/useNavigationStore'
import { useNoteStore } from '../../store/useNoteStore'
import { useTreeIndex } from '../../store/useTreeIndex'
import { AREA_LABEL, DOC_TYPE_LABEL, type DocType, type NodeKind, type TreeNode } from '../../types'
import { DocTypeIcon } from '../common/DocTypeIcon'
import { NameDialog } from '../common/Dialogs'

function itemMeta(node: TreeNode): string {
  if (node.kind === 'folder') return '文件夹'
  const type = (node.docType ?? 'md') as DocType
  return `${DOC_TYPE_LABEL[type]} 文档`
}

export function WorkspaceView() {
  const browse = useNavigationStore((state) => state.browse)
  const openArea = useNavigationStore((state) => state.openArea)
  const openFolder = useNavigationStore((state) => state.openFolder)
  const openDocument = useNavigationStore((state) => state.openDocument)
  const index = useTreeIndex()
  const createNode = useNoteStore((state) => state.createNode)

  const [createKind, setCreateKind] = useState<NodeKind | 'graph' | null>(null)

  const folderNode = browse?.folderId
    ? index.byId.get(browse.folderId)
    : undefined
  const folder = folderNode?.kind === 'folder' && !folderNode.deletedAt
    ? folderNode
    : undefined

  useEffect(() => {
    if (browse?.folderId && !folder) openArea(browse.area)
  }, [browse, folder, openArea])

  if (!browse) return null

  const parentId = folder?.id ?? null
  const children = (index.activeChildren.get(parentId) ?? []).filter(
    (node) => node.area === browse.area,
  )
  const locationName = folder?.name || AREA_LABEL[browse.area]

  return (
    <div className="workspace-view">
      <div className="workspace-head">
        <div>
          <h2>{locationName}</h2>
          <p>{children.length > 0 ? `${children.length} 项` : '空目录'}</p>
        </div>
        <div className="workspace-actions">
          <button type="button" className="btn ghost" onClick={() => setCreateKind('folder')}>
            <FolderPlus size={14} />
            新建文件夹
          </button>
          <button type="button" className="btn ghost" onClick={() => setCreateKind('graph')}>
            <Network size={14} />
            新建关系图
          </button>
          <button type="button" className="btn primary" onClick={() => setCreateKind('doc')}>
            <FilePlus2 size={14} />
            新建文档
          </button>
        </div>
      </div>

      {children.length > 0 ? (
        <div className="workspace-list">
          {children.map((node) => (
            <button
              key={node.id}
              type="button"
              className="workspace-item"
              onClick={() =>
                node.kind === 'folder'
                  ? openFolder(node.area, node.id)
                  : openDocument(node.id)
              }
            >
              <span className={`workspace-item-icon ${node.kind}`}>
                {node.kind === 'folder' ? (
                  <Folder size={17} />
                ) : (
                  <DocTypeIcon docType={node.docType} size={17} />
                )}
              </span>
              <span className="workspace-item-text">
                <span className="workspace-item-name">{node.name || '未命名'}</span>
                <span className="workspace-item-meta">{itemMeta(node)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="workspace-empty">这里还没有内容，点击右上角新建文档或文件夹。</div>
      )}

      {createKind && (
        <NameDialog
          title={`在「${locationName}」中新建${
            createKind === 'folder' ? '文件夹' : createKind === 'graph' ? '关系图' : '文档'
          }`}
          defaultValue={
            createKind === 'folder'
              ? '新建文件夹'
              : createKind === 'graph'
                ? '未命名关系图'
                : '未命名文档'
          }
          confirmText="创建"
          onCancel={() => setCreateKind(null)}
          onConfirm={(name) => {
            const isFolder = createKind === 'folder'
            const id = createNode({
              area: browse.area,
              parentId,
              kind: isFolder ? 'folder' : 'doc',
              ...(createKind === 'graph' ? { docType: 'graph' as const } : {}),
              name,
            })
            setCreateKind(null)
            if (!isFolder) openDocument(id)
          }}
        />
      )}
    </div>
  )
}
