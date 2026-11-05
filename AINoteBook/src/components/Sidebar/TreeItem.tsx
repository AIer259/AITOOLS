import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState, type DragEvent as ReactDragEvent } from 'react'
import { isSharedAttachmentFolder } from '../../lib/trash'
import type { TreeIndex } from '../../lib/treeIndex'
import { showMoveResult } from './moveFeedback'
import {
  canDragNode,
  canDropOnFolder,
  findAttachmentFolder,
  getDraggedNodeId,
  isAttachmentFolder,
  setDraggedNodeId,
} from '../../lib/treeDrag'
import { useNavigationStore } from '../../store/useNavigationStore'
import { useNoteStore } from '../../store/useNoteStore'
import type { NodeKind, TreeNode } from '../../types'
import { DocTypeIcon } from '../common/DocTypeIcon'
import { ConfirmDialog, NameDialog } from '../common/Dialogs'
import { PopupMenu } from '../common/PopupMenu'

interface TreeItemProps {
  node: TreeNode
  depth: number
  index: TreeIndex
}

export function TreeItem({ node, depth, index }: TreeItemProps) {
  const activeId = useNoteStore((state) => state.activeId)
  const expanded = useNoteStore((state) => state.expanded[node.id] ?? false)
  const browse = useNavigationStore((state) => state.browse)
  const trashOpen = useNavigationStore((state) => state.trashOpen)
  const active = activeId === node.id && !browse && !trashOpen
  const browsing = browse?.folderId === node.id
  const openFolder = useNavigationStore((state) => state.openFolder)
  const openDocument = useNavigationStore((state) => state.openDocument)
  const toggleExpanded = useNoteStore((state) => state.toggleExpanded)
  const createNode = useNoteStore((state) => state.createNode)
  const renameNode = useNoteStore((state) => state.renameNode)
  const trashNode = useNoteStore((state) => state.trashNode)

  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [createKind, setCreateKind] = useState<NodeKind | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dropTarget, setDropTarget] = useState(false)
  const draggable = canDragNode(index, node)

  const children = index.activeChildren.get(node.id) ?? []
  const attachmentForDelete = findAttachmentFolder(index, node)
  const hasAttachmentFolder =
    deleting &&
    Boolean(
      attachmentForDelete &&
        !isSharedAttachmentFolder(index, attachmentForDelete.id, node.id),
    )
  const attachmentFolder = isAttachmentFolder(node)

  const handleRowClick = () => {
    if (node.kind === 'folder') openFolder(node.area, node.id)
    else openDocument(node.id)
  }

  const handleDragStart = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggable) {
      event.preventDefault()
      return
    }

    setDraggedNodeId(node.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-ainb-node', node.id)
    event.dataTransfer.setData('text/plain', node.id)
    setDragging(true)
  }

  const handleDragEnd = () => {
    setDraggedNodeId(null)
    setDragging(false)
    setDropTarget(false)
  }

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('application/x-ainb-node')) return
    // 行内事件不再冒泡到区域标题
    event.stopPropagation()
    if (node.kind !== 'folder') return

    const dragId = getDraggedNodeId()
    if (!dragId || !canDropOnFolder(index, dragId, node.id)) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(true)
  }

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget as Node | null
    if (related && event.currentTarget.contains(related)) return
    setDropTarget(false)
  }

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('application/x-ainb-node')) return
    event.preventDefault()
    event.stopPropagation()

    const dragId = getDraggedNodeId()
    setDraggedNodeId(null)
    setDragging(false)
    setDropTarget(false)

    if (!dragId || node.kind !== 'folder') return
    if (!canDropOnFolder(index, dragId, node.id)) {
      showMoveResult('invalid')
      return
    }

    showMoveResult(
      useNoteStore.getState().moveNodeTo(dragId, { area: node.area, parentId: node.id }),
    )
  }

  return (
    <div className="tree-node">
      <div
        className={`tree-row${active ? ' active' : ''}${browsing ? ' is-browsing' : ''}${
          dragging ? ' is-dragging' : ''
        }${dropTarget ? ' is-drop-target' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={draggable}
        onClick={handleRowClick}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        title={node.name}
      >
        <span className="row-chevron">
          {node.kind === 'folder' ? (
            <button
              type="button"
              className={`chevron-btn${expanded ? ' open' : ''}`}
              aria-label={expanded ? '收起文件夹' : '展开文件夹'}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation()
                toggleExpanded(node.id)
              }}
            >
              <ChevronRight size={14} />
            </button>
          ) : (
            <span className="chevron-spacer" />
          )}
        </span>

        <span className={`row-icon ${node.kind}`}>
          {node.kind === 'folder' ? (
            expanded ? (
              <FolderOpen size={15} />
            ) : (
              <Folder size={15} />
            )
          ) : (
            <DocTypeIcon docType={node.docType} size={15} />
          )}
        </span>

        <span className="row-name">{node.name || '未命名'}</span>

        <span className="row-actions">
          {node.kind === 'folder' && (
            <button
              type="button"
              className="row-action"
              title="新建"
              onClick={(event) => {
                event.stopPropagation()
                setCreateMenuOpen(true)
              }}
            >
              <Plus size={14} />
            </button>
          )}
          <button
            type="button"
            className="row-action"
            title="更多"
            onClick={(event) => {
              event.stopPropagation()
              setMoreMenuOpen(true)
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </span>
      </div>

      {createMenuOpen && (
        <PopupMenu
          className="tree-menu"
          onClose={() => setCreateMenuOpen(false)}
          items={[
            {
              label: '新建文档',
              icon: <FileText size={14} />,
              onSelect: () => setCreateKind('doc'),
            },
            {
              label: '新建文件夹',
              icon: <Folder size={14} />,
              onSelect: () => setCreateKind('folder'),
            },
          ]}
        />
      )}

      {moreMenuOpen && (
        <PopupMenu
          className="tree-menu"
          onClose={() => setMoreMenuOpen(false)}
          items={[
            {
              label: '重命名',
              icon: <Pencil size={14} />,
              onSelect: () => setRenaming(true),
            },
            ...(attachmentFolder
              ? []
              : [
                  {
                    label: '移到回收站',
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onSelect: () => setDeleting(true),
                  },
                ]),
          ]}
        />
      )}

      {node.kind === 'folder' && expanded && children.length > 0 && (
        <div className="tree-children">
          {children.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} index={index} />
          ))}
        </div>
      )}

      {createKind && (
        <NameDialog
          title={`在「${node.name}」中新建${createKind === 'doc' ? '文档' : '文件夹'}`}
          defaultValue={createKind === 'doc' ? '未命名文档' : '新建文件夹'}
          confirmText="创建"
          onCancel={() => setCreateKind(null)}
          onConfirm={(name) => {
            createNode({ area: node.area, parentId: node.id, kind: createKind, name })
            setCreateKind(null)
          }}
        />
      )}

      {renaming && (
        <NameDialog
          title="重命名"
          defaultValue={node.name}
          confirmText="保存"
          onCancel={() => setRenaming(false)}
          onConfirm={(name) => {
            renameNode(node.id, name)
            setRenaming(false)
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="移到回收站"
          message={
            node.kind === 'folder'
              ? `将「${node.name}」及其中所有内容移到回收站，可随时恢复。`
              : hasAttachmentFolder
                ? `将「${node.name}」及其附件文件夹移到回收站，可随时恢复。`
                : `将「${node.name}」移到回收站，可随时恢复。`
          }
          confirmText="移到回收站"
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            trashNode(node.id)
            setDeleting(false)
          }}
        />
      )}
    </div>
  )
}
