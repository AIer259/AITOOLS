import { Folder, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  formatTrashTime,
  getTrashLocation,
  summarizeTrash,
} from '../../lib/trash'
import { sweepUnusedAssets } from '../../lib/imageAssets'
import { useNoteStore } from '../../store/useNoteStore'
import { useTreeIndex } from '../../store/useTreeIndex'
import { useUiStore } from '../../store/useUiStore'
import { DOC_TYPE_LABEL, type TreeNode } from '../../types'
import { DocTypeIcon } from '../common/DocTypeIcon'
import { ConfirmDialog, TypeConfirmDialog } from '../common/Dialogs'

interface RestoreAttachmentTarget {
  attachment: TreeNode
  owner: TreeNode
}

function typeLabel(node: TreeNode): string {
  if (node.kind === 'folder') return '文件夹'
  return `${DOC_TYPE_LABEL[node.docType ?? 'md']} 文档`
}

export function TrashView() {
  const index = useTreeIndex()
  const restoreNode = useNoteStore((state) => state.restoreNode)
  const purgeNode = useNoteStore((state) => state.purgeNode)
  const emptyTrash = useNoteStore((state) => state.emptyTrash)
  const flushSave = useNoteStore((state) => state.flushSave)
  const showToast = useUiStore((state) => state.showToast)
  const refreshStorage = useUiStore((state) => state.refreshStorage)

  const [restoreAttachment, setRestoreAttachment] =
    useState<RestoreAttachmentTarget | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<TreeNode | null>(null)
  const [clearOpen, setClearOpen] = useState(false)

  const roots = index.trashRoots
  const summaries = useMemo(
    () => new Map(roots.map((root) => [root.id, summarizeTrash(index, root)])),
    [index, roots],
  )

  const cleanupStorage = () => {
    void (async () => {
      try {
        await flushSave()
        await sweepUnusedAssets()
        await refreshStorage()
      } catch (error) {
        console.error('回收站清理后刷新存储失败', error)
      }
    })()
  }

  const handleRestore = (root: TreeNode) => {
    const hasAttachment = Boolean(summaries.get(root.id)?.attachmentFolder)
    const result = restoreNode(root.id)
    if (!result) return

    const name = result.name || '未命名'
    const message = hasAttachment
      ? `已恢复「${name}」及其附件文件夹`
      : `已恢复「${name}」`
    showToast(
      result.reparented
        ? `${message}，原文件夹不存在，已恢复到分区根目录`
        : message,
      'success',
    )
  }

  const handleConfirmRestoreAttachment = () => {
    if (!restoreAttachment) return

    const result = restoreNode(restoreAttachment.attachment.id)
    if (!result) return

    setRestoreAttachment(null)
    const message = `已恢复「${result.name || '未命名'}」及其附件文件夹`
    showToast(
      result.reparented
        ? `${message}，原文件夹不存在，已恢复到分区根目录`
        : message,
      'success',
    )
  }

  const handleConfirmPurge = () => {
    if (!purgeTarget) return

    const name = purgeTarget.name || '未命名'
    purgeNode(purgeTarget.id)
    setPurgeTarget(null)
    showToast(`已永久删除「${name}」`, 'success')
    cleanupStorage()
  }

  const handleConfirmClear = () => {
    const count = roots.length
    emptyTrash()
    setClearOpen(false)
    showToast(`已清空回收站（${count} 项）`, 'success')
    cleanupStorage()
  }

  const purgeMessage = (root: TreeNode): string => {
    const summary = summaries.get(root.id)
    const name = root.name || '未命名'

    if (root.kind === 'folder') {
      const contained = summary ? summary.docs + summary.folders - 1 : 0
      return contained > 0
        ? `将永久删除「${name}」及其中 ${contained} 项内容，删除后无法恢复。`
        : `将永久删除「${name}」，删除后无法恢复。`
    }

    return summary?.attachmentFolder
      ? `将永久删除「${name}」及其附件文件夹，删除后无法恢复。`
      : `将永久删除「${name}」，删除后无法恢复。`
  }

  return (
    <div className="trash-view">
      <div className="trash-head">
        <div>
          <h2>回收站</h2>
          <p>{roots.length > 0 ? `${roots.length} 项` : '回收站为空'}</p>
        </div>
        <button
          type="button"
          className="btn danger"
          disabled={roots.length === 0}
          onClick={() => setClearOpen(true)}
        >
          <Trash2 size={14} />
          清空回收站
        </button>
      </div>

      {roots.length > 0 ? (
        <div className="trash-list">
          {roots.map((root) => {
            const summary = summaries.get(root.id)
            const attachment = summary?.attachmentFolder
            const contained = summary ? Math.max(0, summary.docs + summary.folders - 1) : 0
            const meta = [typeLabel(root)]

            if (root.kind === 'folder') {
              meta.push(contained > 0 ? `含 ${contained} 项` : '空文件夹')
            } else if (attachment) {
              meta.push('含附件文件夹')
            }
            meta.push(`原位置：${getTrashLocation(index, root)}`)
            meta.push(`删除于 ${formatTrashTime(root.deletedAt)}`)

            return (
              <article className="trash-item" key={root.id}>
                <div className="trash-row">
                  <span className={`workspace-item-icon ${root.kind}`}>
                    {root.kind === 'folder' ? (
                      <Folder size={17} />
                    ) : (
                      <DocTypeIcon docType={root.docType} size={17} />
                    )}
                  </span>
                  <span className="trash-text">
                    <span className="trash-name">{root.name || '未命名'}</span>
                    <span className="trash-meta" title={meta.join(' · ')}>
                      {meta.join(' · ')}
                    </span>
                  </span>
                  <span className="trash-actions">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => handleRestore(root)}
                    >
                      <RotateCcw size={14} />
                      恢复
                    </button>
                    <button
                      type="button"
                      className="btn danger-ghost"
                      onClick={() => setPurgeTarget(root)}
                    >
                      <Trash2 size={14} />
                      永久删除
                    </button>
                  </span>
                </div>

                {attachment && (
                  <div className="trash-child">
                    <Folder size={15} />
                    <span className="trash-text">
                      <span className="trash-name">{attachment.name || '附件'}</span>
                      <span className="trash-meta">附件文件夹 · 随主文档一起恢复或删除</span>
                    </span>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setRestoreAttachment({ attachment, owner: root })}
                    >
                      <RotateCcw size={14} />
                      恢复
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="trash-empty">
          <Trash2 size={26} />
          <p>回收站为空</p>
          <span>删除的文档和文件夹会暂存在这里，可随时恢复。</span>
        </div>
      )}

      {restoreAttachment && (
        <ConfirmDialog
          title="恢复附件文件夹"
          message={`「${restoreAttachment.attachment.name || '附件'}」属于主文档「${
            restoreAttachment.owner.name || '未命名'
          }」。恢复时会连同主文档一起恢复，是否继续？`}
          confirmText="恢复"
          danger={false}
          onCancel={() => setRestoreAttachment(null)}
          onConfirm={handleConfirmRestoreAttachment}
        />
      )}

      {purgeTarget && (
        <ConfirmDialog
          title="永久删除"
          message={purgeMessage(purgeTarget)}
          confirmText="永久删除"
          onCancel={() => setPurgeTarget(null)}
          onConfirm={handleConfirmPurge}
        />
      )}

      {clearOpen && (
        <TypeConfirmDialog
          title="清空回收站"
          message={`将永久删除回收站中的 ${roots.length} 项内容，删除后无法恢复。`}
          expected="确认清空回收站"
          confirmText="清空回收站"
          onCancel={() => setClearOpen(false)}
          onConfirm={handleConfirmClear}
        />
      )}
    </div>
  )
}
