import { Database, FileText, Folder, Moon, NotebookPen, Plus, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatBytes } from '../../lib/storageInfo'
import { useNoteStore } from '../../store/useNoteStore'
import { useUiStore } from '../../store/useUiStore'
import type { Area, NodeKind } from '../../types'
import { NameDialog } from '../common/Dialogs'
import { PopupMenu } from '../common/PopupMenu'
import { TreeItem } from './TreeItem'

const SECTIONS: { area: Area; label: string }[] = [
  { area: 'space', label: '空间' },
  { area: 'private', label: '私人' },
]

interface CreateFor {
  area: Area
  kind: NodeKind
}

export function Sidebar() {
  const nodes = useNoteStore((state) => state.nodes)
  const theme = useNoteStore((state) => state.theme)
  const toggleTheme = useNoteStore((state) => state.toggleTheme)
  const createNode = useNoteStore((state) => state.createNode)
  const storageInfo = useUiStore((state) => state.storageInfo)
  const refreshStorage = useUiStore((state) => state.refreshStorage)

  const [menuArea, setMenuArea] = useState<Area | null>(null)
  const [createFor, setCreateFor] = useState<CreateFor | null>(null)

  useEffect(() => {
    void refreshStorage()
    const handleFocus = () => {
      void refreshStorage()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refreshStorage])

  const storageUsage = storageInfo
    ? storageInfo.supported
      ? `本机存储 ${formatBytes(storageInfo.usage)} / ${formatBytes(storageInfo.quota)}`
      : '本机存储统计不可用'
    : '正在统计本机存储…'

  const persistHint =
    storageInfo?.persisted === true
      ? '已持久化，浏览器不会轻易清理'
      : storageInfo?.persisted === false
        ? '未持久化，清理浏览器数据会丢失'
        : '持久化状态不可用'

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <NotebookPen size={18} />
        </div>
        <div className="brand-text">
          <strong>AINoteBook</strong>
          <span>本地笔记工作台</span>
        </div>
      </div>

      <div className="sidebar-scroll">
        {SECTIONS.map((section) => {
          const roots = nodes.filter((node) => node.area === section.area && node.parentId === null)
          return (
            <section className="tree-section" key={section.area}>
              <div className="section-head">
                <span>{section.label}</span>
                <button
                  type="button"
                  className="section-add"
                  title={`在${section.label}中新建`}
                  onClick={() => setMenuArea(section.area)}
                >
                  <Plus size={14} />
                </button>
                {menuArea === section.area && (
                  <PopupMenu
                    className="section-menu"
                    onClose={() => setMenuArea(null)}
                    items={[
                      {
                        label: '新建文档',
                        icon: <FileText size={14} />,
                        onSelect: () => setCreateFor({ area: section.area, kind: 'doc' }),
                      },
                      {
                        label: '新建文件夹',
                        icon: <Folder size={14} />,
                        onSelect: () => setCreateFor({ area: section.area, kind: 'folder' }),
                      },
                    ]}
                  />
                )}
              </div>

              {roots.length > 0 ? (
                roots.map((node) => (
                  <TreeItem key={node.id} node={node} depth={0} nodes={nodes} />
                ))
              ) : (
                <div className="tree-empty">点击 + 新建文件夹或文档</div>
              )}
            </section>
          )
        })}
      </div>

      <div className="sidebar-footer">
        <button type="button" className="theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
        </button>
        <div className="storage-usage">
          <Database size={12} />
          <span>{storageUsage}</span>
        </div>
        <div className="storage-hint">
          <span
            className={`storage-dot${
              storageInfo?.persisted === true
                ? ' ok'
                : storageInfo?.persisted === false
                  ? ' warn'
                  : ''
            }`}
          />
          <span>{persistHint}</span>
        </div>
      </div>

      {createFor && (
        <NameDialog
          title={`在「${SECTIONS.find((item) => item.area === createFor.area)?.label ?? ''}」中新建${
            createFor.kind === 'doc' ? '文档' : '文件夹'
          }`}
          defaultValue={createFor.kind === 'doc' ? '未命名文档' : '新建文件夹'}
          confirmText="创建"
          onCancel={() => setCreateFor(null)}
          onConfirm={(name) => {
            createNode({
              area: createFor.area,
              parentId: null,
              kind: createFor.kind,
              name,
            })
            setCreateFor(null)
          }}
        />
      )}
    </aside>
  )
}
