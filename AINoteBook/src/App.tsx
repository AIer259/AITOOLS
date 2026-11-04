import { FileText, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BackupBanner } from './components/Backup/BackupBanner'
import { EmbedPicker } from './components/Editor/EmbedPicker'
import { FilePreview } from './components/Editor/FilePreview'
import { NoteEditor } from './components/Editor/NoteEditor'
import { TopBar } from './components/Editor/TopBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TocPanel } from './components/Toc/TocPanel'
import { TrashView } from './components/Trash/TrashView'
import { WorkspaceView } from './components/Workspace/WorkspaceView'
import { SidebarResizer } from './components/common/SidebarResizer'
import { ToastStack } from './components/common/ToastStack'
import { UpdateDialog } from './components/common/UpdateDialog'
import {
  CHECK_TIMEOUT_MS,
  CURRENT_VERSION,
  clearVersionParam,
  fetchLatestVersion,
  isNewerVersion,
  isVersionSkipped,
  reloadToVersion,
  skipVersion,
} from './lib/appUpdate'
import { sweepUnusedAssets } from './lib/imageAssets'
import { applySidebarWidth } from './lib/sidebarLayout'
import { useBackupStore } from './store/useBackupStore'
import { useNavigationStore } from './store/useNavigationStore'
import { useNoteStore } from './store/useNoteStore'
import { useTreeIndex } from './store/useTreeIndex'
import { useUiStore } from './store/useUiStore'

export default function App() {
  const ready = useNoteStore((state) => state.ready)
  const activeId = useNoteStore((state) => state.activeId)
  const init = useNoteStore((state) => state.init)
  const initBackup = useBackupStore((state) => state.init)
  const index = useTreeIndex()
  const browsing = useNavigationStore((state) => state.browse !== null)
  const trashOpen = useNavigationStore((state) => state.trashOpen)
  const tocOpen = useUiStore((state) => state.tocOpen)
  const refreshStorage = useUiStore((state) => state.refreshStorage)
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const startupRef = useRef(false)
  const [update, setUpdate] = useState<{ current: string; latest: string } | null>(
    null,
  )

  useLayoutEffect(() => {
    applySidebarWidth(sidebarWidth)
  }, [sidebarWidth])

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (ready) initBackup()
  }, [ready, initBackup])

  useEffect(() => {
    clearVersionParam()
  }, [])

  useEffect(() => {
    if (!ready || !import.meta.env.PROD) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

    void fetchLatestVersion(controller.signal)
      .then((latest) => {
        if (!latest || !isNewerVersion(latest, CURRENT_VERSION)) return
        if (isVersionSkipped(latest)) return
        setUpdate({ current: CURRENT_VERSION, latest })
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return
        console.warn('检查更新失败', error)
      })
      .finally(() => window.clearTimeout(timer))

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [ready])

  useEffect(() => {
    if (!ready || startupRef.current) return
    startupRef.current = true

    void refreshStorage()
    void sweepUnusedAssets()
      .then((result) => {
        if (result.deleted > 0) void refreshStorage()
      })
      .catch((error) => {
        console.error('图片资源清理失败', error)
      })
  }, [ready, refreshStorage])

  if (!ready) {
    return <div className="loading-screen">正在加载本地笔记…</div>
  }

  const activeNode = index.byId.get(activeId ?? '')
  const active = activeNode && !activeNode.deletedAt ? activeNode : undefined
  const isFilePreview = active?.docType === 'pdf' || active?.docType === 'docx'
  const showToc = tocOpen && !browsing && !trashOpen

  return (
    <>
      <div className="app">
        {sidebarOpen && (
          <>
            <Sidebar />
            <SidebarResizer />
          </>
        )}
        <main className="main">
          <TopBar />
          <BackupBanner />
          {trashOpen ? (
            <TrashView />
          ) : browsing ? (
            <WorkspaceView />
          ) : active ? (
            isFilePreview ? (
              <FilePreview key={active.id} node={active} />
            ) : (
              <NoteEditor key={active.id} node={active} />
            )
          ) : (
            <EmptyState />
          )}
        </main>
        {showToc && <TocPanel />}
      </div>
      <EmbedPicker />
      <ToastStack />
      {update && (
        <UpdateDialog
          currentVersion={update.current}
          latestVersion={update.latest}
          onLater={() => {
            skipVersion(update.latest)
            setUpdate(null)
          }}
          onUpdate={() => reloadToVersion(update.latest)}
        />
      )}
    </>
  )
}

function EmptyState() {
  const createNode = useNoteStore((state) => state.createNode)

  return (
    <div className="empty-state">
      <div className="empty-icon">
        <FileText size={26} />
      </div>
      <h2>选择或新建一篇笔记</h2>
      <p>左侧的空间与私人分区都可以新建文件夹和文档</p>
      <button
        type="button"
        className="btn primary"
        onClick={() =>
          createNode({ area: 'space', parentId: null, kind: 'doc', name: '未命名文档' })
        }
      >
        <Plus size={15} />
        新建文档
      </button>
    </div>
  )
}
