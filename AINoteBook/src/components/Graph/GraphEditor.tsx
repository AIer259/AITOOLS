import { Link2, Plus, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { loadGraphData } from '../../lib/db'
import {
  addGraphNode,
  connectGraphNodes,
  emptyGraph,
  groupColorOf,
  moveGraphNode,
  normalizeGraphData,
  relationOf,
  removeGraphEdge,
  removeGraphNode,
  type GraphData,
  type GraphNode,
} from '../../lib/graph'
import { useNavigationStore } from '../../store/useNavigationStore'
import { useNoteStore } from '../../store/useNoteStore'
import { useTreeIndex } from '../../store/useTreeIndex'
import { useUiStore } from '../../store/useUiStore'
import type { TreeNode } from '../../types'
import { DocTypeIcon } from '../common/DocTypeIcon'
import { GraphDocPicker } from './GraphDocPicker'

const NODE_WIDTH = 190
const NODE_HEIGHT = 64
const CANVAS_WIDTH = 2400
const CANVAS_HEIGHT = 1600
const DRAG_THRESHOLD = 4

interface GraphEditorProps {
  node: TreeNode
}

export function GraphEditor({ node }: GraphEditorProps) {
  const updateGraph = useNoteStore((state) => state.updateGraph)
  const renameNode = useNoteStore((state) => state.renameNode)
  const openDocument = useNavigationStore((state) => state.openDocument)
  const showToast = useUiStore((state) => state.showToast)
  const index = useTreeIndex()

  const [data, setDataState] = useState<GraphData>(emptyGraph())
  const [loaded, setLoaded] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<{ from: string; x: number; y: number } | null>(null)

  const dataRef = useRef(data)
  const loadedRef = useRef(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; moved: boolean } | null>(
    null,
  )
  const connectRef = useRef<string | null>(null)
  const movedRef = useRef(false)

  const setData = useCallback(
    (next: GraphData, save = true) => {
      dataRef.current = next
      setDataState(next)
      if (save && loadedRef.current) updateGraph(node.id, next)
    },
    [node.id, updateGraph],
  )

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    loadedRef.current = false

    loadGraphData(node.id)
      .then((value) => {
        if (cancelled) return
        const next = normalizeGraphData(value)
        dataRef.current = next
        setDataState(next)
        setLoaded(true)
        loadedRef.current = true
      })
      .catch((error) => {
        console.error('加载关系图失败', error)
        if (cancelled) return
        setLoaded(true)
        loadedRef.current = true
      })

    return () => {
      cancelled = true
    }
  }, [node.id])

  const canvasPoint = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const clampPosition = (point: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(CANVAS_WIDTH - NODE_WIDTH, point.x)),
    y: Math.max(0, Math.min(CANVAS_HEIGHT - NODE_HEIGHT, point.y)),
  })

  const handleNodePointerDown = (event: ReactPointerEvent<HTMLDivElement>, item: GraphNode) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('button')) return
    event.stopPropagation()

    const point = canvasPoint(event)
    dragRef.current = {
      id: item.id,
      offsetX: point.x - item.x,
      offsetY: point.y - item.y,
      moved: false,
    }
    movedRef.current = false
    setDraggingId(item.id)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handleNodePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const point = canvasPoint(event)
    const current = dataRef.current.nodes.find((item) => item.id === drag.id)
    if (!current) return

    const next = clampPosition({ x: point.x - drag.offsetX, y: point.y - drag.offsetY })
    if (
      Math.abs(next.x - current.x) > DRAG_THRESHOLD ||
      Math.abs(next.y - current.y) > DRAG_THRESHOLD
    ) {
      drag.moved = true
      movedRef.current = true
    }
    setData(moveGraphNode(dataRef.current, drag.id, next.x, next.y), false)
  }

  const handleNodePointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    setDraggingId(null)
    if (drag?.moved) setData(dataRef.current, true)
  }

  const handleNodeClick = (item: GraphNode) => {
    if (movedRef.current) {
      movedRef.current = false
      return
    }
    const doc = index.byId.get(item.docId)
    if (!doc || doc.deletedAt) {
      showToast('引用的文档已删除', 'error')
      return
    }
    openDocument(doc.id)
  }

  const handleLinkPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, item: GraphNode) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const point = canvasPoint(event)
    connectRef.current = item.id
    setConnecting({ from: item.id, x: point.x, y: point.y })
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handleLinkPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const from = connectRef.current
    if (!from) return
    const point = canvasPoint(event)
    setConnecting({ from, x: point.x, y: point.y })
  }

  const handleLinkPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const from = connectRef.current
    connectRef.current = null
    setConnecting(null)
    if (!from) return

    const element = document.elementFromPoint(event.clientX, event.clientY)
    const target = element?.closest('[data-graph-node]') as HTMLElement | null
    const to = target?.dataset.graphNode
    if (!to || to === from) return

    const next = connectGraphNodes(dataRef.current, from, to)
    if (next === dataRef.current) {
      showToast('无法建立该关系（会形成循环）', 'error')
      return
    }
    setData(next, true)
  }

  const handlePick = (doc: TreeNode) => {
    const count = dataRef.current.nodes.length
    const x = 80 + (count % 4) * (NODE_WIDTH + 50)
    const y = 80 + Math.floor(count / 4) * (NODE_HEIGHT + 56)
    const next = addGraphNode(dataRef.current, doc.id, x, y)
    if (next !== dataRef.current) setData(next, true)
    setPickerOpen(false)
  }

  const selectedDocIds = new Set(data.nodes.map((item) => item.docId))

  return (
    <div className="editor-scroll graph-shell">
      <article className="paper graph-paper">
        <input
          className="note-title"
          value={node.name}
          placeholder="未命名关系图"
          aria-label="关系图名称"
          onChange={(event) => renameNode(node.id, event.target.value)}
          onBlur={() => {
            if (!node.name.trim()) renameNode(node.id, '未命名关系图')
          }}
        />

        <div className="paper-meta">
          <span>关系图文档</span>
          <span className="meta-dot">·</span>
          <span>
            {data.nodes.length} 个节点 · {data.edges.length} 条关系
          </span>
        </div>

        <div className="graph-toolbar">
          <button type="button" className="btn primary" onClick={() => setPickerOpen(true)}>
            <Plus size={14} />
            添加文档
          </button>
          <span className="graph-legend">
            <span className="graph-legend-dot root" />
            根级
            <span className="graph-legend-dot group" />
            同色 = 同级
            <span className="graph-legend-dot orphan" />
            虚线 = 未关联
          </span>
        </div>

        <div className="graph-canvas-scroll">
          <div
            className="graph-canvas"
            ref={canvasRef}
            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
          >
            {!loaded && <div className="graph-empty">正在加载关系图…</div>}
            {loaded && data.nodes.length === 0 && (
              <div className="graph-empty">点击「添加文档」把已有文档加入关系图</div>
            )}

            <svg className="graph-edges" width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
              <defs>
                <marker
                  id="graph-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                </marker>
              </defs>

              {data.edges.map((edge) => {
                const fromNode = data.nodes.find((item) => item.id === edge.from)
                const toNode = data.nodes.find((item) => item.id === edge.to)
                if (!fromNode || !toNode) return null

                const x1 = fromNode.x + NODE_WIDTH
                const y1 = fromNode.y + NODE_HEIGHT / 2
                const x2 = toNode.x
                const y2 = toNode.y + NODE_HEIGHT / 2
                const curve = Math.max(50, Math.abs(x2 - x1) / 2)
                const midX = (x1 + x2) / 2
                const midY = (y1 + y2) / 2

                return (
                  <g key={edge.id}>
                    <path
                      className="graph-edge"
                      d={`M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`}
                      markerEnd="url(#graph-arrow)"
                    />
                    <circle
                      className="graph-edge-hit"
                      cx={midX}
                      cy={midY}
                      r="9"
                      onClick={() => setData(removeGraphEdge(dataRef.current, edge.id), true)}
                    />
                    <text
                      className="graph-edge-x"
                      x={midX}
                      y={midY + 3.5}
                      textAnchor="middle"
                      onClick={() => setData(removeGraphEdge(dataRef.current, edge.id), true)}
                    >
                      ×
                    </text>
                  </g>
                )
              })}

              {connecting &&
                (() => {
                  const fromNode = data.nodes.find((item) => item.id === connecting.from)
                  if (!fromNode) return null
                  const x1 = fromNode.x + NODE_WIDTH
                  const y1 = fromNode.y + NODE_HEIGHT / 2
                  return (
                    <path
                      className="graph-edge-preview"
                      d={`M ${x1} ${y1} L ${connecting.x} ${connecting.y}`}
                      markerEnd="url(#graph-arrow)"
                    />
                  )
                })()}
            </svg>

            {data.nodes.map((item) => {
              const doc = index.byId.get(item.docId)
              const alive = Boolean(doc && !doc.deletedAt)
              const relation = relationOf(item.id, data)
              const color = groupColorOf(item.id, data)
              const parentGraphNode =
                relation.kind === 'child'
                  ? data.nodes.find((candidate) => candidate.id === relation.parentId)
                  : undefined
              const parentDoc = parentGraphNode
                ? index.byId.get(parentGraphNode.docId)
                : undefined

              return (
                <div
                  key={item.id}
                  className={`graph-node${draggingId === item.id ? ' dragging' : ''}${
                    relation.kind === 'orphan' ? ' orphan' : ''
                  }`}
                  data-graph-node={item.id}
                  style={{
                    left: item.x,
                    top: item.y,
                    width: NODE_WIDTH,
                    minHeight: NODE_HEIGHT,
                    borderColor: color ?? undefined,
                  }}
                  onPointerDown={(event) => handleNodePointerDown(event, item)}
                  onPointerMove={handleNodePointerMove}
                  onPointerUp={handleNodePointerUp}
                  onClick={() => handleNodeClick(item)}
                >
                  <span className="graph-node-icon">
                    <DocTypeIcon docType={doc?.docType} size={15} />
                  </span>
                  <span className="graph-node-body">
                    <span className="graph-node-name" title={doc?.name}>
                      {alive ? doc?.name : '文档已删除'}
                    </span>
                    <span className="graph-node-relation">
                      {relation.kind === 'root' && '根级'}
                      {relation.kind === 'child' &&
                        `下级 · 上级：${parentDoc?.name ?? '已删除'}`}
                      {relation.kind === 'orphan' && '未关联'}
                    </span>
                  </span>

                  <button
                    type="button"
                    className="graph-node-remove"
                    title="从关系图移除"
                    onClick={(event) => {
                      event.stopPropagation()
                      setData(removeGraphNode(dataRef.current, item.id), true)
                    }}
                  >
                    <X size={13} />
                  </button>

                  <button
                    type="button"
                    className="graph-node-link"
                    title="拖到另一节点，建立「上一级 → 下一级」"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => handleLinkPointerDown(event, item)}
                    onPointerMove={handleLinkPointerMove}
                    onPointerUp={handleLinkPointerUp}
                  >
                    <Link2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {pickerOpen && (
          <GraphDocPicker
            selectedDocIds={selectedDocIds}
            onSelect={handlePick}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </article>
    </div>
  )
}
