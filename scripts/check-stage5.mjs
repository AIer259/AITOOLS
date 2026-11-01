import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://localhost:5173'
const shotDir = path.resolve('.tmp-shots')
const pdfPath = path.resolve('scripts/fixtures/sample.pdf')
const docxPath = path.resolve('node_modules/mammoth/test/test-data/tables.docx')
fs.mkdirSync(shotDir, { recursive: true })
assert.ok(fs.existsSync(pdfPath), '缺少测试 PDF')

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: path.resolve(`.tmp-chrome-stage5-${Date.now()}`),
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1500, height: 1100 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

async function clickIn(selector, text) {
  const handles = await page.$$(selector)
  for (const handle of handles) {
    const label = await handle.evaluate((el) => el.textContent?.trim() ?? '')
    if (label.includes(text)) {
      await handle.click()
      return
    }
  }
  throw new Error(`未找到可点击项：${selector} / ${text}`)
}

async function clickLastParagraph() {
  const handle = await page.evaluateHandle(() => {
    const root = document.querySelector('.note-prose')
    if (!root) return null
    const paragraphs = [...root.querySelectorAll(':scope > p')]
    return paragraphs[paragraphs.length - 1] ?? root
  })
  const element = handle.asElement()
  assert.ok(element, '找不到末尾段落')
  await element.click()
}

async function openEmbedPicker() {
  await clickLastParagraph()
  await page.keyboard.type('/embed')
  await page.waitForFunction(
    () => document.querySelector('.slash-item .slash-title')?.textContent === '嵌入文档',
  )
  await page.keyboard.press('Enter')
  await page.waitForSelector('.embed-picker')
}

async function findEmbedHandle(name) {
  const handle = await page.evaluateHandle((embedName) => {
    return (
      [...document.querySelectorAll('.embed-node')].find(
        (el) => el.querySelector('.embed-name')?.textContent === embedName,
      ) ?? null
    )
  }, name)
  const element = handle.asElement()
  assert.ok(element, `未找到嵌入卡片：${name}`)
  return element
}

await page.goto(URL, { waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')

// 新建测试笔记
const adds = await page.$$('.section-add')
await adds[0].click()
await page.waitForSelector('.popup-menu')
const menuButtons = await page.$$('.popup-menu button')
await menuButtons[0].click()
await page.waitForSelector('.dialog input')
await page.$eval('.dialog input', (input) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, '嵌套文档测试')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const dialogButtons = await page.$$('.dialog-actions button')
await dialogButtons[1].click()
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '嵌套文档测试')
await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)

// 1. 嵌入 Markdown 笔记
await openEmbedPicker()
await clickIn('.embed-item', '欢迎使用 AINoteBook')
await page.waitForFunction(() => document.querySelectorAll('.embed-node').length === 1)
const firstEmbed = await page.evaluate(() => ({
  name: document.querySelector('.embed-node .embed-name')?.textContent,
  badge: document.querySelector('.embed-node .embed-badge')?.textContent,
  title: document.querySelector('.note-title')?.value,
}))
assert.equal(firstEmbed.name, '欢迎使用 AINoteBook')
assert.equal(firstEmbed.badge, 'Markdown')
assert.equal(firstEmbed.title, '嵌套文档测试')

const firstEmbedHandle = await findEmbedHandle('欢迎使用 AINoteBook')
const firstMain = await firstEmbedHandle.$('.embed-main')
await firstMain.click()
await page.waitForSelector('.embed-node .embed-md')
await page.waitForFunction(() =>
  document.querySelector('.embed-node .embed-md')?.textContent?.includes('本地优先'),
)
await page.screenshot({ path: path.join(shotDir, 'stage5-embed-md.png') })

// 2. 嵌入 PDF（上传）
await openEmbedPicker()
const pickerFileInput = await page.$('.embed-picker input[type="file"]')
assert.ok(pickerFileInput, '选择器里没有文件输入框')
await pickerFileInput.uploadFile(pdfPath)
await page.waitForFunction(() => !document.querySelector('.embed-picker'), { timeout: 20000 })
await page.waitForFunction(() => document.querySelectorAll('.embed-node').length === 2, { timeout: 20000 })
const pdfBadge = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.embed-node')].find(
    (el) => el.querySelector('.embed-name')?.textContent === 'sample',
  )
  return card?.querySelector('.embed-badge')?.textContent
})
assert.equal(pdfBadge, 'PDF')

const pdfEmbed = await findEmbedHandle('sample')
const pdfMain = await pdfEmbed.$('.embed-main')
await pdfMain.click()
await page.waitForSelector('.embed-node iframe.embed-pdf', { timeout: 20000 })
const pdfSrc = await page.$eval('.embed-node iframe.embed-pdf', (el) => el.getAttribute('src'))
assert.ok(pdfSrc?.startsWith('blob:'), 'PDF 嵌入未加载 blob')

// 3. 嵌入 Word（上传）
await openEmbedPicker()
const pickerFileInput2 = await page.$('.embed-picker input[type="file"]')
await pickerFileInput2.uploadFile(docxPath)
await page.waitForFunction(() => !document.querySelector('.embed-picker'), { timeout: 20000 })
await page.waitForFunction(() => document.querySelectorAll('.embed-node').length === 3, { timeout: 20000 })
const docxEmbed = await findEmbedHandle('tables')
const docxMain = await docxEmbed.$('.embed-main')
await docxMain.click()
await page.waitForSelector('.embed-docx table', { timeout: 20000 })
await page.screenshot({ path: path.join(shotDir, 'stage5-embed-all.png') })

// 4. 从侧栏打开 PDF 文件预览
const pdfRow = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.tree-row')].find(
    (el) => el.querySelector('.row-name')?.textContent === 'sample',
  ) ?? null,
)
const pdfRowEl = pdfRow.asElement()
assert.ok(pdfRowEl, '侧栏未找到上传的 PDF')
await pdfRowEl.click()
await page.waitForSelector('.file-preview.pdf')
const previewSrc = await page.$eval('.file-preview-pdf', (el) => el.getAttribute('src'))
assert.ok(previewSrc?.startsWith('blob:'), 'PDF 预览未加载')

// 5. 从侧栏打开 Word 预览
const docxRow = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.tree-row')].find(
    (el) => el.querySelector('.row-name')?.textContent === 'tables',
  ) ?? null,
)
const docxRowEl = docxRow.asElement()
assert.ok(docxRowEl, '侧栏未找到上传的 Word')
await docxRowEl.click()
await page.waitForSelector('.file-preview-docx table', { timeout: 20000 })

// 6. 返回测试笔记，刷新验证持久化
const noteRow = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.tree-row')].find(
    (el) => el.querySelector('.row-name')?.textContent === '嵌套文档测试',
  ) ?? null,
)
await noteRow.asElement().click()
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '嵌套文档测试')
await page.waitForFunction(() => document.querySelectorAll('.embed-node').length === 3)

await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '嵌套文档测试')
await page.waitForFunction(() => document.querySelectorAll('.embed-node').length === 3)

const pdfEmbedAfterReload = await findEmbedHandle('sample')
const pdfMainAfterReload = await pdfEmbedAfterReload.$('.embed-main')
await pdfMainAfterReload.click()
await page.waitForSelector('.embed-node iframe.embed-pdf', { timeout: 20000 })
const pdfSrcAfterReload = await page.$eval('.embed-node iframe.embed-pdf', (el) => el.getAttribute('src'))
assert.ok(pdfSrcAfterReload?.startsWith('blob:'), '刷新后 PDF 嵌入无法加载')

await page.screenshot({ path: path.join(shotDir, 'stage5-persisted.png') })
await browser.close()

const results = {
  firstEmbed,
  pdfBadge,
  embedCount: 3,
  pdfPreview: previewSrc?.slice(0, 20),
  pdfEmbedAfterReload: pdfSrcAfterReload?.slice(0, 20),
  consoleErrors: errors,
}
console.log(JSON.stringify(results, null, 2))
if (errors.length) process.exit(1)
console.log('阶段五自测全部通过')
