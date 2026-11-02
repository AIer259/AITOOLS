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

const importFile = path.resolve('.tmp-imports/导入测试.md')
fs.mkdirSync(path.dirname(importFile), { recursive: true })
fs.writeFileSync(
  importFile,
  `# 导入测试内容

这是从 Markdown 导入的段落。

- 列表项一
- 列表项二

| 名称 | 数量 |
| --- | --- |
| 苹果 | 2 |
`,
  'utf8',
)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: path.resolve(`.tmp-chrome-stage4-${Date.now()}`),
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

await page.goto(URL, { waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')
await page.waitForFunction(() => !document.querySelector('button[title="搜索当前文档"]')?.disabled)

async function waitForDownload(ext, timeout = 60000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const files = fs.readdirSync(downloadDir).filter((file) => file.endsWith(ext))
    if (files.length > 0) {
      const target = path.join(downloadDir, files[0])
      if (fs.statSync(target).size > 0) return target
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`等待 ${ext} 下载超时`)
}

// 1. 搜索
await page.click('button[title="搜索当前文档"]')
await page.waitForSelector('.search-panel')
await page.focus('.search-panel input')
await page.keyboard.sendCharacter('折叠')
await page.waitForFunction(() => /\d+\/\d+/.test(document.querySelector('.search-count')?.textContent ?? ''))
const searchCount = await page.$eval('.search-count', (el) => el.textContent)
const hits = await page.$$eval('.search-hit', (els) => els.length)
const currentHits = await page.$$eval('.search-hit.current', (els) => els.length)
assert.ok(hits > 0, '搜索高亮没有生成')
assert.equal(currentHits, 1, '当前高亮应只有一个')

await page.keyboard.press('Enter')
await page.waitForFunction((before) => document.querySelector('.search-count')?.textContent !== before, {}, searchCount)
const searchCountAfterNext = await page.$eval('.search-count', (el) => el.textContent)
assert.notEqual(searchCountAfterNext, searchCount)

await page.screenshot({ path: path.join(shotDir, 'stage4-search.png') })

await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.search-panel'))
assert.equal(await page.$$eval('.search-hit', (els) => els.length), 0)

// 2. 目录
await page.click('button[title="展开目录"]')
await page.waitForSelector('.toc-panel')
await page.waitForFunction(() => document.querySelectorAll('.toc-item').length >= 3)
const tocItems = await page.$$eval('.toc-item', (els) => els.map((el) => el.textContent))
assert.ok(tocItems.length >= 3, `目录项过少：${tocItems.join(', ')}`)

await page.$eval('.note-body-scroll', (el) => {
  el.scrollTop = 0
})
await new Promise((resolve) => setTimeout(resolve, 150))
const scrollBefore = await page.$eval('.note-body-scroll', (el) => el.scrollTop)
const targetHandle = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.toc-item')].find((el) => el.textContent === '简单表格') ?? null,
)
const target = targetHandle.asElement()
assert.ok(target, '未找到「简单表格」目录项')
await target.click()
await page.waitForFunction(() =>
  document.querySelector('.toc-item.active')?.textContent === '简单表格',
)
await new Promise((resolve) => setTimeout(resolve, 600))
const scrollAfter = await page.$eval('.note-body-scroll', (el) => el.scrollTop)
assert.ok(scrollAfter > scrollBefore, '点击目录后没有滚动')
await page.screenshot({ path: path.join(shotDir, 'stage4-toc.png') })

// 3. 导入 Markdown
const fileInputs = await page.$$('input[type="file"]')
assert.ok(fileInputs.length >= 2, '未找到导入文件输入框')
await fileInputs[0].uploadFile(importFile)
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '导入测试')
await page.waitForFunction(() =>
  [...document.querySelectorAll('.note-prose p')].some((el) =>
    el.textContent?.includes('这是从 Markdown 导入的段落'),
  ),
)
const imported = await page.evaluate(() => ({
  h1: [...document.querySelectorAll('.note-prose h1')].some(
    (el) => el.textContent === '导入测试内容',
  ),
  table: document.querySelectorAll('.note-prose table').length,
  bullets: document.querySelectorAll('.note-prose ul li').length,
}))
assert.ok(imported.h1 && imported.table > 0 && imported.bullets >= 2, '导入内容不完整')

// 4. 导出 Markdown
await page.click('button[title="导出"]')
await page.waitForSelector('.topbar-menu')
let items = await page.$$('.topbar-menu button')
for (const item of items) {
  const label = await item.evaluate((el) => el.textContent ?? '')
  if (label.includes('导出 Markdown')) {
    await item.click()
    break
  }
}
const mdFile = await waitForDownload('.md', 15000)
const mdContent = fs.readFileSync(mdFile, 'utf8')
assert.ok(mdContent.startsWith('# 导入测试'), '导出的 Markdown 标题不正确')
assert.ok(mdContent.includes('这是从 Markdown 导入的段落。'), '导出的 Markdown 缺少正文')
assert.ok(mdContent.includes('列表项一'), '导出的 Markdown 缺少列表')
assert.ok(mdContent.includes('| 名称 | 数量 |') || mdContent.includes('名称 | 数量'), '导出的 Markdown 缺少表格')

// 5. 导出 PDF（直接下载）
await page.click('button[title="导出"]')
await page.waitForSelector('.topbar-menu')
items = await page.$$('.topbar-menu button')
for (const item of items) {
  const label = await item.evaluate((el) => el.textContent ?? '')
  if (label.includes('直接下载')) {
    await item.click()
    break
  }
}
const pdfFile = await waitForDownload('.pdf', 90000)
const pdfBuffer = fs.readFileSync(pdfFile)
assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF', 'PDF 文件头不正确')
assert.ok(pdfBuffer.length > 20000, `PDF 文件过小：${pdfBuffer.length}`)

await browser.close()

const results = {
  searchCount,
  searchCountAfterNext,
  hits,
  currentHits,
  tocItems,
  scrollBefore,
  scrollAfter,
  imported,
  markdownFile: path.basename(mdFile),
  markdownLength: mdContent.length,
  pdfFile: path.basename(pdfFile),
  pdfBytes: pdfBuffer.length,
  consoleErrors: errors,
}
console.log(JSON.stringify(results, null, 2))
if (errors.length) process.exit(1)
console.log('阶段四自测全部通过')
