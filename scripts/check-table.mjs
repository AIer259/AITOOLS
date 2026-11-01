import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://localhost:5173'
const shotDir = path.resolve('.tmp-shots')
const downloadDir = path.resolve('.tmp-downloads')
fs.mkdirSync(shotDir, { recursive: true })
fs.mkdirSync(downloadDir, { recursive: true })
for (const file of fs.readdirSync(downloadDir)) fs.unlinkSync(path.join(downloadDir, file))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: path.resolve(`.tmp-chrome-table-${Date.now()}`),
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1500, height: 1000 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

const client = await page.createCDPSession()
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })

async function waitForDownload(ext, timeout = 90000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const files = fs
      .readdirSync(downloadDir)
      .filter((file) => file.endsWith(ext) && !file.endsWith('.crdownload'))
    if (files.length > 0) {
      const target = path.join(downloadDir, files[0])
      if (fs.statSync(target).size > 0) return target
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`等待 ${ext} 下载超时`)
}

async function clickExport(label) {
  await page.waitForFunction(() => !document.querySelector('button[title="导出"]')?.disabled)
  await page.click('button[title="导出"]')
  await page.waitForSelector('.topbar-menu')
  const buttons = await page.$$('.topbar-menu button')
  for (const button of buttons) {
    const text = await button.evaluate((el) => el.textContent ?? '')
    if (text.includes(label)) {
      await button.click()
      return
    }
  }
  throw new Error(`未找到导出项：${label}`)
}

async function typeText(text) {
  for (const char of text) await page.keyboard.sendCharacter(char)
}

async function tableState() {
  return page.evaluate(() => {
    const wrapper = document.querySelector('.note-table-wrap')
    const table = wrapper?.querySelector('table')
    if (!wrapper || !table) {
      return null
    }
    const row = table.rows[0]
    const lastRow = table.rows[table.rows.length - 1]
    const widths = [...wrapper.querySelectorAll('colgroup col')].map((col) =>
      Number.parseFloat(col.style.width),
    )
    const autofit = wrapper.querySelector('.note-table-autofit')
    const toolbar = wrapper.querySelector('.note-table-toolbar')
    return {
      rows: table.rows.length,
      cols: row?.cells.length ?? 0,
      lastRowCells: lastRow?.cells.length ?? 0,
      widths,
      widthSum: widths.reduce((sum, width) => sum + width, 0),
      tableWidth: table.getBoundingClientRect().width,
      wrapperWidth: wrapper.getBoundingClientRect().width,
      firstCellWidth: row?.cells[0]?.getBoundingClientRect().width ?? 0,
      secondCellWidth: row?.cells[1]?.getBoundingClientRect().width ?? 0,
      autofitOpacity: autofit ? getComputedStyle(autofit).opacity : '0',
      toolbarOpacity: toolbar ? getComputedStyle(toolbar).opacity : '0',
      active: wrapper.classList.contains('is-active'),
    }
  })
}

function assertFullWidth(state, message) {
  assert.ok(
    Math.abs(state.tableWidth - state.wrapperWidth) < 1.5,
    `${message}：表格 ${state.tableWidth}px，容器 ${state.wrapperWidth}px`,
  )
  assert.ok(Math.abs(state.widthSum - 100) < 0.2, `${message}：列宽合计 ${state.widthSum}%`)
}

await page.goto(URL, { waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')

// 新建测试笔记
const adds = await page.$$('.section-add')
await adds[0].click()
await page.waitForSelector('.popup-menu')
const menuButtons = await page.$$('.popup-menu button')
for (const button of menuButtons) {
  const text = await button.evaluate((el) => el.textContent ?? '')
  if (text.includes('文档')) {
    await button.click()
    break
  }
}
await page.waitForSelector('.dialog input')
await page.$eval('.dialog input', (input) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, '表格测试')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForFunction(() => document.querySelector('.dialog input')?.value === '表格测试')
await new Promise((resolve) => setTimeout(resolve, 150))
const dialogButtons = await page.$$('.dialog-actions button')
for (const button of dialogButtons) {
  const text = await button.evaluate((el) => el.textContent ?? '')
  if (text.includes('创建')) {
    await button.click()
    break
  }
}
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '表格测试')
await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)

async function clearEditor() {
  await page.click('.ProseMirror')
  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.waitForFunction(
    () => (document.querySelector('.note-prose')?.textContent ?? '').trim() === '',
  )
}

async function checkSlashQuery(query) {
  await clearEditor()
  await page.keyboard.type('/')
  await page.keyboard.type(query)
  await page.waitForFunction(
    () => document.querySelector('.slash-item .slash-title')?.textContent === '复杂表格',
    { timeout: 5000 },
  )
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.slash-menu'))
}

// /f、/fz、/ f 都应命中复杂表格
await checkSlashQuery('f')
await checkSlashQuery('fz')
await checkSlashQuery(' f')
await clearEditor()

// 插入 3×3 表格
await page.keyboard.type('/biaoge')
await page.waitForFunction(
  () => document.querySelector('.slash-item .slash-title')?.textContent === '复杂表格',
)
await page.keyboard.press('Enter')
await page.waitForSelector('.note-prose .note-table-wrap table')

const initial = await tableState()
assert.equal(initial.rows, 3, '初始表格行数不正确')
assert.equal(initial.cols, 3, '初始表格列数不正确')
assertFullWidth(initial, '初始表格')

// 右侧 + 加列，底部 + 加行，右下角 + 同时加行列
await page.hover('.note-prose table')
await page.waitForFunction(
  () => Number(getComputedStyle(document.querySelector('.note-table-add-col')).opacity) > 0.9,
)
const hoverState = await tableState()
assert.ok(hoverState.rows === 3 && hoverState.cols === 3, '悬停后表格尺寸不应变化')

await page.click('.note-table-add-col')
await page.waitForFunction(() => document.querySelector('table')?.rows[0]?.cells.length === 4)
await page.hover('.note-prose table')
await page.click('.note-table-add-row')
await page.waitForFunction(() => document.querySelector('table')?.rows.length === 4)
await page.hover('.note-prose table')
await page.click('.note-table-add-both')
await page.waitForFunction(() => {
  const table = document.querySelector('table')
  return table?.rows.length === 5 && table.rows[0]?.cells.length === 5
})

const grown = await tableState()
assert.equal(grown.rows, 5, '右下角按钮没有添加行')
assert.equal(grown.cols, 5, '右下角按钮没有添加列')
assert.equal(grown.lastRowCells, 5, '新增行没有覆盖所有列')
assertFullWidth(grown, '加行列后')

// 写入不同长度的内容，供自适应测量
await page.click('.note-prose table tr:first-child > *:first-child')
await typeText('短')
await page.keyboard.press('Tab')
await typeText('这是一段很长很长的内容')
await page.keyboard.press('Tab')
await typeText('中等内容')
await page.keyboard.press('Tab')
await typeText('四')
await page.keyboard.press('Tab')
await typeText('五')
await page.waitForFunction(() =>
  document.querySelector('.note-prose table')?.textContent?.includes('这是一段很长很长的内容'),
)

// 光标在表格内时，自适应按钮应保持可见（即使鼠标移到表格外）
await page.click('.note-prose table tr:first-child > *:first-child')
await page.mouse.move(1250, 880)
await new Promise((resolve) => setTimeout(resolve, 250))
const activeState = await tableState()
assert.ok(activeState.active, '点击表格后没有激活状态')
assert.ok(activeState.toolbarOpacity > 0.9, '光标在表格内时删除工具条没有显示')

// 拖动第一、二列分隔线
await page.hover('.note-prose table')
await page.waitForFunction(
  () => Number(getComputedStyle(document.querySelector('.note-table-add-col')).opacity) > 0.9,
)
const beforeDrag = await tableState()
const handle = await page.$('.note-table-col-handle')
assert.ok(handle, '没有生成列宽拖拽手柄')
const box = await handle.boundingBox()
assert.ok(box, '拖拽手柄没有布局坐标')
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 8 })
await page.mouse.up()
await new Promise((resolve) => setTimeout(resolve, 300))

const afterDrag = await tableState()
assert.ok(afterDrag.firstCellWidth > beforeDrag.firstCellWidth + 10, '拖动后第一列没有变宽')
assert.ok(afterDrag.secondCellWidth < beforeDrag.secondCellWidth - 10, '拖动后第二列没有变窄')
assertFullWidth(afterDrag, '拖动列宽后')

// 自适应：长内容列应比短内容列宽
await page.hover('.note-prose table')
await page.waitForFunction(
  () => Number(getComputedStyle(document.querySelector('.note-table-toolbar')).opacity) > 0.9,
)
await page.click('.note-table-autofit')
await new Promise((resolve) => setTimeout(resolve, 300))
const afterFit = await tableState()
assert.ok(afterFit.secondCellWidth > afterFit.firstCellWidth, '自适应没有按内容加宽长内容列')
assertFullWidth(afterFit, '自适应后')
await page.screenshot({ path: path.join(shotDir, 'table-enhanced.png') })

// 删行、删列、删整表，并验证 Ctrl+Z 撤销
async function clickFirstBodyCell() {
  await page.click('.note-prose table tr:nth-child(2) > *:first-child')
  await page.waitForFunction(
    () => Number(getComputedStyle(document.querySelector('.note-table-toolbar')).opacity) > 0.9,
  )
}

await clickFirstBodyCell()
await page.click('.note-table-delete-row')
await page.waitForFunction(() => document.querySelector('table')?.rows.length === 4)
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelector('table')?.rows.length === 5)

await clickFirstBodyCell()
await page.click('.note-table-delete-col')
await page.waitForFunction(() => document.querySelector('table')?.rows[0]?.cells.length === 4)
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelector('table')?.rows[0]?.cells.length === 5)

await clickFirstBodyCell()
await page.click('.note-table-delete-table')
await page.waitForFunction(() => !document.querySelector('.note-prose table'))
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelector('.note-prose table')?.rows.length === 5)

// 右键菜单：按鼠标目标精确删除
async function rightClickCellWithText(text) {
  await page.waitForSelector('.note-prose table')
  const handle = await page.evaluateHandle((label) => {
    return (
      [...document.querySelectorAll('.note-prose table th, .note-prose table td')].find(
        (cell) => cell.textContent?.trim() === label,
      ) ?? null
    )
  }, text)
  const element = handle.asElement()
  assert.ok(element, `找不到内容为「${text}」的单元格`)
  await element.click({ button: 'right' })
  await page.waitForSelector('.note-table-context-menu')
}

async function clickContextItem(label) {
  const buttons = await page.$$('.note-table-context-menu button')
  for (const button of buttons) {
    const text = await button.evaluate((el) => el.textContent ?? '')
    if (text.includes(label)) {
      await button.click()
      return
    }
  }
  throw new Error(`右键菜单没有「${label}」`)
}

await rightClickCellWithText('中等内容')
const contextItems = await page.$$eval('.note-table-context-menu button', (els) =>
  els.map((el) => el.textContent),
)
assert.deepEqual(contextItems, ['删除当前行', '删除当前列', '删除整个表格'])
await clickContextItem('删除当前列')
await page.waitForFunction(() => document.querySelector('table')?.rows[0]?.cells.length === 4)
const removedColumn = await page.evaluate(() =>
  [...document.querySelectorAll('table th, table td')].some(
    (cell) => cell.textContent?.includes('中等内容'),
  ),
)
assert.ok(!removedColumn, '右键删列没有删中目标列')
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelector('table')?.rows[0]?.cells.length === 5)

await rightClickCellWithText('四')
await clickContextItem('删除当前行')
await page.waitForFunction(() => document.querySelector('table')?.rows.length === 4)
const removedRow = await page.evaluate(() =>
  [...document.querySelectorAll('table th, table td')].some(
    (cell) => cell.textContent?.trim() === '四',
  ),
)
assert.ok(!removedRow, '右键删行没有删中目标行')
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelector('table')?.rows.length === 5)

await rightClickCellWithText('短')
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.note-table-context-menu'))
await rightClickCellWithText('短')
await clickContextItem('删除整个表格')
await page.waitForFunction(() => !document.querySelector('.note-prose table'))
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelector('.note-prose table')?.rows.length === 5)

// 保存后刷新，列宽应保留
await page.waitForFunction(() =>
  document.querySelector('.save-state')?.textContent?.includes('已保存'),
)
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '表格测试')
await page.waitForSelector('.note-prose .note-table-wrap table')
const persisted = await tableState()
assert.equal(persisted.rows, 5, '刷新后行数丢失')
assert.equal(persisted.cols, 5, '刷新后列数丢失')
assert.ok(
  Math.abs(persisted.widthSum - afterFit.widthSum) < 0.5,
  '刷新后列宽没有保留',
)
assertFullWidth(persisted, '刷新后')

// Markdown 导出仍为合法表格
await clickExport('单文件')
const mdPath = await waitForDownload('.md')
const markdown = fs.readFileSync(mdPath, 'utf8')
assert.ok(markdown.includes('| 短 |'), 'Markdown 表格缺少首列内容')
assert.ok(markdown.includes('这是一段很长很长的内容'), 'Markdown 表格缺少长内容')
assert.ok(!markdown.includes('colgroup'), 'Markdown 残留 colgroup')

// PDF 保留列宽后可正常生成
await clickExport('直接下载')
const pdfPath = await waitForDownload('.pdf')
const pdfBuffer = fs.readFileSync(pdfPath)
assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF')
assert.ok(pdfBuffer.length > 10000, '表格 PDF 文件过小')

// 嵌套预览使用百分比 colgroup
const previewHtml = await page.evaluate(async () => {
  const { docJsonToHtml } = await import('/src/lib/renderDoc.ts')
  const cell = (text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })
  return docJsonToHtml({
    type: 'doc',
    content: [
      {
        type: 'table',
        attrs: { colWidths: [30, 70] },
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [cell('A')] },
              { type: 'tableHeader', content: [cell('B')] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [cell('1')] },
              { type: 'tableCell', content: [cell('2')] },
            ],
          },
        ],
      },
    ],
  })
})
assert.ok(previewHtml.includes('data-col-widths'), '嵌套预览缺少列宽属性')
assert.ok(previewHtml.includes('width: 30%'), '嵌套预览缺少第一列百分比')
assert.ok(previewHtml.includes('width: 70%'), '嵌套预览缺少第二列百分比')

await browser.close()

const results = {
  initial: { rows: initial.rows, cols: initial.cols },
  grown: { rows: grown.rows, cols: grown.cols },
  drag: {
    before: [beforeDrag.firstCellWidth, beforeDrag.secondCellWidth],
    after: [afterDrag.firstCellWidth, afterDrag.secondCellWidth],
  },
  fit: {
    first: afterFit.firstCellWidth,
    second: afterFit.secondCellWidth,
    widths: afterFit.widths,
  },
  deletion: { row: true, column: true, table: true, undo: true },
  contextMenu: { items: contextItems, row: true, column: true, table: true },
  persistedWidths: persisted.widths,
  markdownBytes: Buffer.byteLength(markdown),
  pdfBytes: pdfBuffer.length,
  consoleErrors: errors,
}
console.log(JSON.stringify(results, null, 2))
if (errors.length) process.exit(1)
console.log('增强表格自测全部通过')
