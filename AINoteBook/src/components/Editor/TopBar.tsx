import {
  ChevronRight,
  Download,
  FileArchive,
  FileDown,
  FileText,
  FileType2,
  ListTree,
  PanelLeftOpen,
  Printer,
  Search,
  Upload,
} from 'lucide-react'
import { Fragment, useMemo, useRef, useState } from 'react'
import type { ImportKind } from '../../application/importDocument'
import { BackupMenu } from '../Backup/BackupMenu'
import {
  exportMarkdown,
  exportMarkdownZip,
  exportPdfDirect,
  exportPdfPrint,
} from '../../lib/fileExport'
import { getPath } from '../../lib/tree'
import { useNavigationStore } from '../../store/useNavigationStore'
import { useNoteStore } from '../../store/useNoteStore'
import { useTreeIndex } from '../../store/useTreeIndex'
import { useUiStore } from '../../store/useUiStore'
import { AREA_LABEL } from '../../types'
import { PopupMenu } from '../common/PopupMenu'
import { SearchPanel } from './SearchPanel'

type ExportKind = 'md' | 'md-zip' | 'pdf-direct' | 'pdf-print'

export function TopBar() {
  const index = useTreeIndex()
  const activeId = useNoteStore((state) => state.activeId)
  const saveState = useNoteStore((state) => state.saveState)
  const importDocument = useNoteStore((state) => state.importDocument)
  const browse = useNavigationStore((state) => state.browse)
  const trashOpen = useNavigationStore((state) => state.trashOpen)
  const openArea = useNavigationStore((state) => state.openArea)
  const openFolder = useNavigationStore((state) => state.openFolder)

  const editor = useUiStore((state) => state.editor)
  const tocOpen = useUiStore((state) => state.tocOpen)
  const toggleToc = useUiStore((state) => state.toggleToc)
  const searchOpen = useUiStore((state) => state.searchOpen)
  const setSearchOpen = useUiStore((state) => state.setSearchOpen)
  const showToast = useUiStore((state) => state.showToast)
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)

  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const mdInputRef = useRef<HTMLInputElement>(null)
  const docxInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  const activeNode = index.byId.get(activeId ?? '')
  const active = activeNode && !activeNode.deletedAt ? activeNode : undefined
  const path = useMemo(() => {
    if (browse) return browse.folderId ? getPath(index, browse.folderId) : []
    return getPath(index, activeId)
  }, [index, activeId, browse])
  const area = browse?.area ?? path[0]?.area ?? active?.area ?? null
  const canEdit = Boolean(active && active.kind === 'doc' && (active.docType ?? 'md') === 'md' && editor)

  const handleImport = async (file: File, kind: ImportKind) => {
    setBusy(true)
    try {
      const target = browse
        ? { area: browse.area, parentId: browse.folderId }
        : active
          ? { area: active.area, parentId: active.parentId }
          : undefined
      const result = await importDocument(file, kind, { target })

      showToast(`已导入「${result.name}」`, 'success')
    } catch (error) {
      console.error(error)
      const message =
        error instanceof Error && error.message === '压缩包中找不到 Markdown 文件'
          ? error.message
          : '导入失败：请确认文件格式与内容'
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async (kind: ExportKind) => {
    if (!editor || !active) return

    if (kind === 'md' || kind === 'md-zip') {
      setBusy(true)
      try {
        if (kind === 'md') await exportMarkdown(editor, active.name)
        else {
          const state = useNoteStore.getState()
          await exportMarkdownZip(editor, active.name, {
            nodes: state.nodes,
            activeId: state.activeId,
            readContent: state.readContent,
          })
        }
        showToast(
          kind === 'md' ? 'Markdown 已导出' : 'Markdown + 图片 ZIP 已导出',
          'success',
        )
      } catch (error) {
        console.error(error)
        showToast('导出失败，请稍后重试', 'error')
      } finally {
        setBusy(false)
      }
      return
    }

    setBusy(true)
    try {
      if (kind === 'pdf-direct') {
        showToast('正在生成 PDF…', 'info')
        await exportPdfDirect(editor, active.name)
        showToast('PDF 已下载', 'success')
      } else {
        await exportPdfPrint(editor, active.name)
        showToast('已打开打印窗口，请选择「另存为 PDF」', 'info')
      }
    } catch (error) {
      console.error(error)
      showToast('PDF 导出失败，请稍后重试', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className={`topbar${trashOpen ? ' in-trash' : ''}`}>
      <div className="topbar-lead">
        {!sidebarOpen && (
          <button
            type="button"
            className="icon-button"
            title="展开侧栏"
            aria-label="展开侧栏"
            onClick={toggleSidebar}
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
        <div className="breadcrumb">
          {trashOpen ? (
            <span className="crumb current">回收站</span>
          ) : area ? (
            <>
              <button
                type="button"
                className={`crumb crumb-button${
                  browse && browse.folderId === null ? ' current' : ''
                }`}
                onClick={() => openArea(area)}
              >
                {AREA_LABEL[area]}
              </button>
              {path.map((node) => {
                const current = browse ? node.id === browse.folderId : node.id === activeId
                const clickable = node.kind === 'folder'

                return (
                  <Fragment key={node.id}>
                    <ChevronRight size={13} className="crumb-sep" />
                    {clickable ? (
                      <button
                        type="button"
                        className={`crumb crumb-button${current ? ' current' : ''}`}
                        title={node.name}
                        onClick={() => openFolder(node.area, node.id)}
                      >
                        {node.name || '未命名'}
                      </button>
                    ) : (
                      <span className={`crumb${current ? ' current' : ''}`} title={node.name}>
                        {node.name || '未命名'}
                      </span>
                    )}
                  </Fragment>
                )
              })}
            </>
          ) : (
            <span className="crumb current">AINoteBook</span>
          )}
        </div>
      </div>

      <div className="topbar-actions">
        <span className={`save-state ${saveState}`}>
          {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : ''}
        </span>

        <button
          type="button"
          className={`icon-button${searchOpen ? ' active' : ''}`}
          title="搜索当前文档"
          aria-pressed={searchOpen}
          disabled={!canEdit}
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <Search size={16} />
        </button>

        <button
          type="button"
          className={`icon-button${tocOpen ? ' active' : ''}`}
          title={tocOpen ? '收起目录' : '展开目录'}
          aria-pressed={tocOpen}
          disabled={!canEdit}
          onClick={toggleToc}
        >
          <ListTree size={16} />
        </button>

        <div className="topbar-action-wrap">
          <button
            type="button"
            className="icon-button"
            title="导入"
            disabled={busy}
            onClick={() => setImportOpen(true)}
          >
            <Upload size={16} />
          </button>
          {importOpen && (
            <PopupMenu
              className="topbar-menu"
              onClose={() => setImportOpen(false)}
              items={[
                {
                  label: '导入 Markdown',
                  icon: <FileText size={14} />,
                  onSelect: () => mdInputRef.current?.click(),
                },
                {
                  label: '导入 Word 文档',
                  icon: <FileType2 size={14} />,
                  onSelect: () => docxInputRef.current?.click(),
                },
                {
                  label: '导入 Markdown + 图片（ZIP）',
                  icon: <FileArchive size={14} />,
                  onSelect: () => zipInputRef.current?.click(),
                },
              ]}
            />
          )}
        </div>

        <div className="topbar-action-wrap">
          <button
            type="button"
            className="icon-button"
            title="导出"
            disabled={!canEdit || busy}
            onClick={() => setExportOpen(true)}
          >
            <Download size={16} />
          </button>
          {exportOpen && (
            <PopupMenu
              className="topbar-menu"
              onClose={() => setExportOpen(false)}
              items={[
                {
                  label: '导出 Markdown（单文件）',
                  icon: <FileText size={14} />,
                  onSelect: () => void handleExport('md'),
                },
                {
                  label: '导出 Markdown + 图片（ZIP）',
                  icon: <FileArchive size={14} />,
                  onSelect: () => void handleExport('md-zip'),
                },
                {
                  label: '导出 PDF（直接下载）',
                  icon: <FileDown size={14} />,
                  onSelect: () => void handleExport('pdf-direct'),
                },
                {
                  label: '导出 PDF（浏览器打印）',
                  icon: <Printer size={14} />,
                  onSelect: () => void handleExport('pdf-print'),
                },
              ]}
            />
          )}
        </div>

        <BackupMenu />

        <input
          ref={mdInputRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleImport(file, 'md')
          }}
        />
        <input
          ref={docxInputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleImport(file, 'docx')
          }}
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleImport(file, 'zip')
          }}
        />
      </div>

      <SearchPanel />
    </header>
  )
}
