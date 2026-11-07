export interface GraphNode {
  id: string
  docId: string
  x: number
  y: number
}

export interface GraphEdge {
  id: string
  from: string
  to: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type GraphRelation =
  | { kind: 'root' }
  | { kind: 'child'; parentId: string }
  | { kind: 'orphan' }

const GROUP_COLORS = ['#4f8cff', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4']

export function emptyGraph(): GraphData {
  return { nodes: [], edges: [] }
}

function createGraphId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 容错解析：丢弃结构不完整的节点与悬空/自环边 */
export function normalizeGraphData(value: unknown): GraphData {
  if (!value || typeof value !== 'object') return emptyGraph()
  const raw = value as Partial<GraphData>

  const nodes: GraphNode[] = Array.isArray(raw.nodes)
    ? raw.nodes
        .filter(
          (node): node is GraphNode =>
            Boolean(node) && typeof node.id === 'string' && typeof node.docId === 'string',
        )
        .map((node) => ({
          id: node.id,
          docId: node.docId,
          x: Number(node.x) || 0,
          y: Number(node.y) || 0,
        }))
    : []

  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges: GraphEdge[] = Array.isArray(raw.edges)
    ? raw.edges.filter(
        (edge) =>
          Boolean(edge) &&
          typeof edge.id === 'string' &&
          typeof edge.from === 'string' &&
          typeof edge.to === 'string' &&
          edge.from !== edge.to &&
          nodeIds.has(edge.from) &&
          nodeIds.has(edge.to),
      )
    : []

  return { nodes, edges }
}

/** 同一文档只保留一个节点 */
export function addGraphNode(
  data: GraphData,
  docId: string,
  x: number,
  y: number,
): GraphData {
  if (data.nodes.some((node) => node.docId === docId)) return data
  return { ...data, nodes: [...data.nodes, { id: createGraphId(), docId, x, y }] }
}

export function removeGraphNode(data: GraphData, nodeId: string): GraphData {
  return {
    nodes: data.nodes.filter((node) => node.id !== nodeId),
    edges: data.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
  }
}

export function moveGraphNode(
  data: GraphData,
  nodeId: string,
  x: number,
  y: number,
): GraphData {
  return {
    ...data,
    nodes: data.nodes.map((node) => (node.id === nodeId ? { ...node, x, y } : node)),
  }
}

/** 每个节点最多一个父节点（第一条入边） */
export function parentMap(data: GraphData): Map<string, string> {
  const parents = new Map<string, string>()
  for (const edge of data.edges) {
    if (!parents.has(edge.to)) parents.set(edge.to, edge.from)
  }
  return parents
}

/** from → to 是否会形成环（to 是 from 的祖先） */
export function wouldCreateCycle(data: GraphData, from: string, to: string): boolean {
  if (from === to) return true
  const parents = parentMap(data)
  let cursor = parents.get(from)
  while (cursor) {
    if (cursor === to) return true
    cursor = parents.get(cursor)
  }
  return false
}

/** 建立「上一级 → 下一级」箭头；单父语义：替换 to 已有的入边 */
export function connectGraphNodes(data: GraphData, from: string, to: string): GraphData {
  if (from === to || wouldCreateCycle(data, from, to)) return data
  if (data.edges.some((edge) => edge.from === from && edge.to === to)) return data
  const edges = data.edges.filter((edge) => edge.to !== to)
  return { ...data, edges: [...edges, { id: createGraphId(), from, to }] }
}

export function removeGraphEdge(data: GraphData, edgeId: string): GraphData {
  return { ...data, edges: data.edges.filter((edge) => edge.id !== edgeId) }
}

export function relationOf(nodeId: string, data: GraphData): GraphRelation {
  const edge = data.edges.find((item) => item.to === nodeId)
  if (edge) return { kind: 'child', parentId: edge.from }
  const hasOut = data.edges.some((item) => item.from === nodeId)
  return hasOut ? { kind: 'root' } : { kind: 'orphan' }
}

/** 同级节点（共享同一父节点）使用同一颜色；根级统一色；未关联返回 null */
export function groupColorOf(nodeId: string, data: GraphData): string | null {
  const relation = relationOf(nodeId, data)
  if (relation.kind === 'orphan') return null
  if (relation.kind === 'root') return GROUP_COLORS[0]

  let hash = 0
  for (const char of relation.parentId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return GROUP_COLORS[hash % GROUP_COLORS.length]
}

/** 导出为可读的 Markdown 关系列表（备份 ZIP 与单文档导出共用） */
export function buildGraphMarkdown(
  name: string,
  data: GraphData,
  resolveDocName: (docId: string) => string,
): string {
  const nodeName = (nodeId: string) => {
    const node = data.nodes.find((item) => item.id === nodeId)
    return node ? resolveDocName(node.docId) : '未知节点'
  }

  const lines = [`# ${name.trim() || '未命名关系图'}`, '']

  if (data.edges.length > 0) {
    lines.push('## 关系（上一级 → 下一级）', '')
    for (const edge of data.edges) {
      lines.push(`- ${nodeName(edge.from)} → ${nodeName(edge.to)}`)
    }
    lines.push('')
  }

  const roots = data.nodes.filter((node) => relationOf(node.id, data).kind === 'root')
  const orphans = data.nodes.filter((node) => relationOf(node.id, data).kind === 'orphan')

  if (roots.length > 0) {
    lines.push('## 根级', '', ...roots.map((node) => `- ${nodeName(node.id)}`), '')
  }
  if (orphans.length > 0) {
    lines.push('## 未关联', '', ...orphans.map((node) => `- ${nodeName(node.id)}`), '')
  }

  return lines.join('\n')
}
