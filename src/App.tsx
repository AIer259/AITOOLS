import { FileText, Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { EmbedPicker } from './components/Editor/EmbedPicker'
import { FilePreview } from './components/Editor/FilePreview'
import { NoteEditor } from './components/Editor/NoteEditor'
import { TopBar } from './components/Editor/TopBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TocPanel } from './components/Toc/TocPanel'
import { ToastStack } from './components/common/ToastStack'
import { sweepUnusedAssets } from './lib/imageAssets'
import { useNoteStore } from './store/useNoteStore'
import { useUiStore } from './store/useUiStore'

export default function App() {
  const ready = useNoteStore((state) => state.ready)
  const nodes = useNoteStore((state) => state.nodes)
  const activeId = useNoteStore((state) => state.activeId)
  const init = useNoteStore((state) => state.init)
  const tocOpen = useUiStore((state) => state.tocOpen)
  const refreshStorage = useUiStore((state) => state.refreshStorage)
  const startupRef = useRef(false)

  useEffect(() => {
    void init()
  }, [init])

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

  const active = nodes.find((node) => node.id === activeId)
  const isFilePreview = active?.docType === 'pdf' || active?.docType === 'docx'

  return (
    <>
      <div className={`app${tocOpen ? ' with-toc' : ''}`}>
        <Sidebar />
        <main className="main">
          <TopBar />
          {active ? (
            isFilePreview ? (
              <FilePreview key={active.id} node={active} />
            ) : (
              <NoteEditor key={active.id} node={active} />
            )
          ) : (
            <EmptyState />
          )}
        </main>
        {tocOpen && <TocPanel />}
      </div>
      <EmbedPicker />
      <ToastStack />
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
