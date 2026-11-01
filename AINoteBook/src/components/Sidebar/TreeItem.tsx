import {
  ChevronRight,
  File,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNoteStore } from '../../store/useNoteStore'
import type { DocType, NodeKind, TreeNode } from '../../types'
import { ConfirmDialog, NameDialog } from '../common/Dialogs'
import { PopupMenu } from '../common/PopupMenu'

interface TreeItemProps {
  node: TreeNode
  depth: number
  nodes: TreeNode[]
}

function DocIcon({ docType }: { docType?: DocType }) {
  if (docType === 'pdf') return <File size={15} />
  if (docType === 'docx') return <FileType2 size={15} />
  return <FileText size={15} />
}

export function TreeItem({ node, depth, nodes }: TreeItemProps) {
  const active = useNoteStore((state) => state.activeId === node.id)
  const expanded = useNoteStore((state) => state.expanded[node.id] ?? true)
  const setActive = useNoteStore((state) => state.setActive)
  const toggleExpanded = useNoteStore((state) => state.toggleExpanded)
  const createNode = useNoteStore((state) => state.createNode)
  const renameNode = useNoteStore((state) => state.renameNode)
  const deleteNode = useNoteStore((state) => state.deleteNode)

  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [createKind, setCreateKind] = useState<NodeKind | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const children = useMemo(
    () => nodes.filter((child) => child.parentId === node.id),
    [nodes, node.id],
  )

  const handleRowClick = () => {
    if (node.kind === 'folder') toggleExpanded(node.id)
    else setActive(node.id)
  }

  return (
    <div className="tree-node">
      <div
        className={`tree-row${active ? ' active' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={handleRowClick}
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
            <DocIcon docType={node.docType} />
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
            {
              label: '删除',
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setDeleting(true),
            },
          ]}
        />
      )}

      {node.kind === 'folder' && expanded && children.length > 0 && (
        <div className="tree-children">
          {children.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} nodes={nodes} />
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
          title={`删除${node.kind === 'folder' ? '文件夹' : '文档'}`}
          message={
            node.kind === 'folder'
              ? `将删除「${node.name}」及其中所有内容，删除后无法恢复。`
              : `确定删除「${node.name}」吗？删除后无法恢复。`
          }
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            deleteNode(node.id)
            setDeleting(false)
          }}
        />
      )}
    </div>
  )
}
