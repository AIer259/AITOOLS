import { mergeAttributes } from '@tiptap/core'
import { Table } from '@tiptap/extension-table'
import type { DOMOutputSpec, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
} from '@tiptap/pm/tables'
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view'
import { useUiStore } from '../store/useUiStore'

const DEFAULT_MIN_CELL_WIDTH = 56

function parseColumnWidths(raw: string | null): number[] | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return null
    const numbers = value.map((item) => Number(item))
    if (!numbers.every((item) => Number.isFinite(item) && item > 0)) return null
    return numbers
  } catch {
    return null
  }
}

export function getColumnCount(node: ProseMirrorNode): number {
  const row = node.firstChild
  if (!row) return 0

  let count = 0
  row.forEach((cell) => {
    count += Number(cell.attrs.colspan) || 1
  })
  return count
}

export function normalizeColumnWidths(value: unknown, count: number): number[] {
  if (count <= 0) return []

  if (Array.isArray(value) && value.length === count) {
    const numbers = value.map((item) => Number(item))
    if (numbers.every((item) => Number.isFinite(item) && item > 0)) {
      const total = numbers.reduce((sum, item) => sum + item, 0)
      if (total > 0) return numbers.map((item) => (item / total) * 100)
    }
  }

  return Array.from({ length: count }, () => 100 / count)
}

function roundColumnWidths(widths: number[]): number[] {
  if (widths.length === 0) return []
  const rounded = widths.map((width) => Math.round(width * 100) / 100)
  const total = rounded.reduce((sum, width) => sum + width, 0)
  const lastIndex = rounded.length - 1
  rounded[lastIndex] = Math.round((rounded[lastIndex] + (100 - total)) * 100) / 100
  return rounded
}

function sameWidths(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((width, index) => Math.abs(width - b[index]) < 0.01)
}

export class EnhancedTableView implements NodeView {
  node: ProseMirrorNode
  dom: HTMLDivElement
  contentDOM: HTMLTableSectionElement

  private readonly view: EditorView
  private readonly getPos: () => number | undefined
  private readonly cellMinWidth: number
  private readonly table: HTMLTableElement
  private readonly colgroup: HTMLTableColElement
  private readonly controls: HTMLDivElement
  private readonly handles: HTMLDivElement
  private readonly abort = new AbortController()
  private stopResize: (() => void) | null = null
  private contextMenu: HTMLDivElement | null = null
  private contextCell: HTMLTableCellElement | null = null
  private contextCleanup: (() => void) | null = null
  private destroyed = false

  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    view: EditorView,
    HTMLAttributes: Record<string, unknown>,
    getPos: () => number | undefined,
  ) {
    this.node = node
    this.cellMinWidth = cellMinWidth || DEFAULT_MIN_CELL_WIDTH
    this.view = view
    this.getPos = getPos

    this.dom = document.createElement('div')
    this.dom.className = 'tableWrapper note-table-wrap'

    this.table = document.createElement('table')
    for (const [key, value] of Object.entries(HTMLAttributes)) {
      if (value === undefined || value === null) continue
      if (key === 'style') this.table.style.cssText = String(value)
      else this.table.setAttribute(key, String(value))
    }
    this.table.style.width = '100%'
    this.table.style.tableLayout = 'fixed'
    this.table.style.minWidth = '0'

    this.colgroup = document.createElement('colgroup')
    this.table.append(this.colgroup)
    this.contentDOM = document.createElement('tbody')
    this.table.append(this.contentDOM)
    this.dom.append(this.table)

    this.controls = document.createElement('div')
    this.controls.className = 'note-table-controls'
    this.controls.contentEditable = 'false'

    const toolbar = document.createElement('div')
    toolbar.className = 'note-table-toolbar'
    toolbar.append(
      this.createButton('note-table-delete-row', '删行', '删除当前行（Ctrl+Z 可撤销）', () =>
        this.deleteCurrentRow(),
      ),
      this.createButton('note-table-delete-col', '删列', '删除当前列（Ctrl+Z 可撤销）', () =>
        this.deleteCurrentColumn(),
      ),
      this.createButton('note-table-delete-table', '删表', '删除整个表格（Ctrl+Z 可撤销）', () =>
        this.deleteCurrentTable(),
      ),
      this.createButton('note-table-autofit', '↔ 自适应', '按内容自动适应列宽', () =>
        this.fitToContent(),
      ),
    )

    this.controls.append(
      toolbar,
      this.createButton('note-table-add-col', '+', '在右侧添加列', () => this.addColumn()),
      this.createButton('note-table-add-row', '+', '在下方添加行', () => this.addRow()),
      this.createButton('note-table-add-both', '+', '同时添加行和列', () =>
        this.addRowAndColumn(),
      ),
    )
    this.dom.append(this.controls)

    this.handles = document.createElement('div')
    this.handles.className = 'note-table-handles'
    this.handles.contentEditable = 'false'
    this.dom.append(this.handles)

    this.table.addEventListener(
      'mousedown',
      () => this.dom.classList.add('is-active'),
      { signal: this.abort.signal },
    )
    this.table.addEventListener('contextmenu', this.handleContextMenu, {
      signal: this.abort.signal,
    })
    document.addEventListener('selectionchange', this.handleSelectionChange, {
      signal: this.abort.signal,
    })

    this.renderWidths()
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.renderWidths()
    return true
  }

  stopEvent(event: Event): boolean {
    const target = event.target
    return (
      target instanceof HTMLElement &&
      Boolean(target.closest('.note-table-controls, .note-table-handles'))
    )
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target as globalThis.Node
    return this.dom.contains(target) && !this.contentDOM.contains(target)
  }

  destroy(): void {
    this.destroyed = true
    this.closeContextMenu()
    this.abort.abort()
    this.stopResize?.()
  }

  private readonly handleSelectionChange = () => {
    const anchor = document.getSelection()?.anchorNode
    const element =
      anchor?.nodeType === globalThis.Node.ELEMENT_NODE
        ? (anchor as Element)
        : anchor?.parentElement ?? null
    this.dom.classList.toggle('is-active', Boolean(element && this.table.contains(element)))
  }

  private readonly handleContextMenu = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    const cell = target.closest('td, th') as HTMLTableCellElement | null
    if (!cell || !this.table.contains(cell)) return

    event.preventDefault()
    event.stopPropagation()
    this.openContextMenu(cell, event.clientX, event.clientY)
  }

  private createButton(
    className: string,
    text: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `note-table-control ${className}`
    button.textContent = text
    button.title = label
    button.setAttribute('aria-label', label)

    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      onClick()
    })
    return button
  }

  private renderWidths(): void {
    const count = getColumnCount(this.node)
    const widths = normalizeColumnWidths(this.node.attrs.colWidths, count)

    while (this.colgroup.children.length < count) {
      this.colgroup.append(document.createElement('col'))
    }
    while (this.colgroup.children.length > count) {
      this.colgroup.lastElementChild?.remove()
    }

    this.applyWidths(widths)
    this.rebuildHandles(widths)
  }

  private applyWidths(widths: number[]): void {
    for (let index = 0; index < widths.length; index += 1) {
      const col = this.colgroup.children[index] as HTMLTableColElement | undefined
      if (col) col.style.width = `${widths[index].toFixed(2)}%`
    }
    this.positionHandles(widths)
  }

  private rebuildHandles(widths: number[]): void {
    this.handles.replaceChildren()
    const count = getColumnCount(this.node)

    for (let index = 0; index < count - 1; index += 1) {
      const handle = document.createElement('div')
      handle.className = 'note-table-col-handle'
      handle.dataset.index = String(index)
      handle.addEventListener('pointerdown', (event) => this.startResize(event, index))
      this.handles.append(handle)
    }

    this.positionHandles(widths)
  }

  private positionHandles(widths: number[]): void {
    let left = 0
    for (let index = 0; index < widths.length - 1; index += 1) {
      left += widths[index]
      const handle = this.handles.children[index] as HTMLElement | undefined
      if (handle) handle.style.left = `${left}%`
    }
  }

  private startResize(event: PointerEvent, index: number): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    const rect = this.table.getBoundingClientRect()
    if (!rect.width) return

    const count = getColumnCount(this.node)
    const widths = normalizeColumnWidths(this.node.attrs.colWidths, count)
    const left = widths[index]
    const right = widths[index + 1]
    if (left === undefined || right === undefined) return

    const minWidth = Math.min((this.cellMinWidth / rect.width) * 100, (left + right) / 2)
    const startX = event.clientX
    let moved = false

    this.dom.classList.add('is-resizing')
    document.body.classList.add('is-col-resizing')

    const onMove = (moveEvent: PointerEvent) => {
      const delta = ((moveEvent.clientX - startX) / rect.width) * 100
      const nextLeft = Math.max(minWidth, Math.min(left + right - minWidth, left + delta))
      const nextRight = left + right - nextLeft
      if (Math.abs(nextLeft - left) < 0.01) return
      moved = true
      widths[index] = nextLeft
      widths[index + 1] = nextRight
      this.applyWidths(widths)
    }

    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('is-col-resizing')
      this.dom.classList.remove('is-resizing')
      this.stopResize = null
      if (moved && !this.destroyed) this.commitWidths(roundColumnWidths(widths))
      if (!this.destroyed) this.view.focus()
    }

    this.stopResize = finish

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
  }

  private commitWidths(widths: number[]): void {
    const pos = this.getPos()
    if (pos == null) return

    const tableNode = this.view.state.doc.nodeAt(pos)
    if (!tableNode || tableNode.type !== this.node.type) return

    const current = normalizeColumnWidths(tableNode.attrs.colWidths, getColumnCount(tableNode))
    if (sameWidths(current, widths)) return

    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...tableNode.attrs,
        colWidths: widths,
      }),
    )
  }

  private measureContentWidths(): number[] | null {
    const count = getColumnCount(this.node)
    const row = this.table.rows[0]
    if (!row || !count) return null

    const cols = Array.from(this.colgroup.children) as HTMLTableColElement[]
    const previousTableWidth = this.table.style.width
    const previousLayout = this.table.style.tableLayout
    const previousColWidths = cols.map((col) => col.style.width)

    try {
      this.table.style.width = 'auto'
      this.table.style.tableLayout = 'auto'
      for (const col of cols) col.style.width = ''

      const measured: number[] = []
      for (const cell of Array.from(row.cells)) {
        const span = Math.max(1, cell.colSpan)
        const width = cell.getBoundingClientRect().width / span
        for (let index = 0; index < span; index += 1) measured.push(width)
      }

      return measured.length === count ? measured : null
    } finally {
      this.table.style.width = previousTableWidth
      this.table.style.tableLayout = previousLayout
      cols.forEach((col, index) => {
        col.style.width = previousColWidths[index] ?? ''
      })
    }
  }

  private fitToContent(): void {
    const count = getColumnCount(this.node)
    if (!count) return

    const measured =
      this.measureContentWidths() ??
      Array.from({ length: count }, () => 100 / count)
    const minPercent = Math.min(8, 100 / count)
    const clamped = measured.map((width) => Math.max(width, minPercent))
    const total = clamped.reduce((sum, width) => sum + width, 0)
    const widths = clamped.map((width) => (width / total) * 100)

    this.commitWidths(roundColumnWidths(widths))
    this.view.focus()
  }

  private openContextMenu(cell: HTMLTableCellElement, x: number, y: number): void {
    this.closeContextMenu()
    this.contextCell = cell

    const menu = document.createElement('div')
    menu.className = 'note-table-context-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', '表格操作')

    const actions = [
      { label: '删除当前行', action: 'row' as const },
      { label: '删除当前列', action: 'column' as const },
      { label: '删除整个表格', action: 'table' as const },
    ]

    for (const item of actions) {
      if (item.action === 'table') {
        const separator = document.createElement('div')
        separator.className = 'note-table-context-separator'
        menu.append(separator)
      }

      const button = document.createElement('button')
      button.type = 'button'
      button.className = `note-table-context-item${
        item.action === 'table' ? ' is-danger' : ''
      }`
      button.textContent = item.label
      button.setAttribute('role', 'menuitem')
      button.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.runContextAction(item.action)
      })
      menu.append(button)
    }

    menu.style.visibility = 'hidden'
    document.body.append(menu)

    const box = menu.getBoundingClientRect()
    const margin = 8
    menu.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - box.width - margin))}px`
    menu.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - box.height - margin))}px`
    menu.style.visibility = 'visible'
    this.contextMenu = menu

    const onPointerDown = (event: PointerEvent) => {
      if (!menu.contains(event.target as globalThis.Node)) this.closeContextMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      this.closeContextMenu()
    }
    const onViewportChange = () => this.closeContextMenu()

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)

    this.contextCleanup = () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }

  private closeContextMenu(): void {
    this.contextCleanup?.()
    this.contextCleanup = null
    this.contextMenu?.remove()
    this.contextMenu = null
    this.contextCell = null
  }

  private runContextAction(action: 'row' | 'column' | 'table'): void {
    const cell = this.contextCell
    this.closeContextMenu()
    if (!cell || !cell.isConnected || !this.table.contains(cell)) return

    this.selectCell(cell)
    if (action === 'row') this.deleteCurrentRow()
    else if (action === 'column') this.deleteCurrentColumn()
    else this.deleteCurrentTable()
  }

  private deleteCurrentRow(): void {
    if (!isInTable(this.view.state)) return
    if (!deleteRow(this.view.state, this.view.dispatch)) return
    this.view.focus()
    useUiStore.getState().showToast('已删除行，Ctrl+Z 可撤销')
  }

  private deleteCurrentColumn(): void {
    if (!isInTable(this.view.state)) return
    if (!deleteColumn(this.view.state, this.view.dispatch)) return
    this.view.focus()
    useUiStore.getState().showToast('已删除列，Ctrl+Z 可撤销')
  }

  private deleteCurrentTable(): void {
    if (!isInTable(this.view.state)) return
    if (!deleteTable(this.view.state, this.view.dispatch)) return
    this.view.focus()
    useUiStore.getState().showToast('已删除表格，Ctrl+Z 可撤销')
  }

  private selectCell(cell: HTMLTableCellElement): void {
    const pos = this.view.posAtDOM(cell, 0)
    if (pos < 0) return
    const selection = TextSelection.near(this.view.state.doc.resolve(pos))
    this.view.dispatch(this.view.state.tr.setSelection(selection))
  }

  private focusLastCellInRow(rowIndex: number): void {
    const row = this.table.rows[rowIndex]
    const cell = row?.cells[row.cells.length - 1]
    if (cell) this.selectCell(cell)
  }

  private currentWidths(): number[] {
    return normalizeColumnWidths(this.node.attrs.colWidths, getColumnCount(this.node))
  }

  private widthsAfterColumnAdd(previous: number[]): number[] {
    const share = 100 / (previous.length + 1)
    const factor = (100 - share) / 100
    return roundColumnWidths([...previous.map((width) => width * factor), share])
  }

  private addColumn(): void {
    const row = this.table.rows[0]
    const cell = row?.cells[row.cells.length - 1]
    if (!cell) return

    const previous = this.node.attrs.colWidths ? this.currentWidths() : null
    this.selectCell(cell)
    addColumnAfter(this.view.state, this.view.dispatch)
    if (previous) this.commitWidths(this.widthsAfterColumnAdd(previous))
    this.focusLastCellInRow(0)
    this.view.focus()
  }

  private addRow(): void {
    const row = this.table.rows[this.table.rows.length - 1]
    const cell = row?.cells[0]
    if (!cell) return

    this.selectCell(cell)
    addRowAfter(this.view.state, this.view.dispatch)
    this.focusLastCellInRow(this.table.rows.length - 1)
    this.view.focus()
  }

  private addRowAndColumn(): void {
    const row = this.table.rows[this.table.rows.length - 1]
    const cell = row?.cells[row.cells.length - 1]
    if (!cell) return

    const previous = this.node.attrs.colWidths ? this.currentWidths() : null
    this.selectCell(cell)
    addColumnAfter(this.view.state, this.view.dispatch)
    addRowAfter(this.view.state, this.view.dispatch)
    if (previous) this.commitWidths(this.widthsAfterColumnAdd(previous))
    this.focusLastCellInRow(this.table.rows.length - 1)
    this.view.focus()
  }
}

export const EnhancedTable = Table.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      colWidths: {
        default: null,
        parseHTML: (element) => parseColumnWidths(element.getAttribute('data-col-widths')),
        renderHTML: (attributes) => {
          const widths = attributes.colWidths
          if (!Array.isArray(widths) || widths.length === 0) return {}
          return { 'data-col-widths': JSON.stringify(widths) }
        },
      },
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    const count = getColumnCount(node)
    const widths = normalizeColumnWidths(node.attrs.colWidths, count)
    const cols: DOMOutputSpec[] = widths.map((width) => [
      'col',
      { style: `width: ${width.toFixed(2)}%` },
    ])

    const table: DOMOutputSpec = [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        style: 'width: 100%; table-layout: fixed',
      }),
      ['colgroup', {}, ...cols],
      ['tbody', 0],
    ]

    return this.options.renderWrapper
      ? ['div', { class: 'tableWrapper' }, table]
      : table
  },

  addNodeView() {
    return ({ node, view, getPos, HTMLAttributes }) => {
      const attributes = mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
      ) as Record<string, unknown>
      return new EnhancedTableView(
        node,
        this.options.cellMinWidth,
        view,
        attributes,
        getPos,
      )
    }
  },
})
