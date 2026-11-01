import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://localhost:5173'
const shotDir = path.resolve('.tmp-shots')
fs.mkdirSync(shotDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: path.resolve(`.tmp-chrome-layout-${Date.now()}`),
  ignoreDefaultArgs: ['--hide-scrollbars'],
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1600, height: 1000 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

const countParagraphs = () => page.$$eval('.note-prose > p', (els) => els.length)
const isEditorFocused = () =>
  page.evaluate(() => Boolean(document.activeElement?.closest('.ProseMirror')))

await page.goto(URL, { waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')

// 1. 宽度与固定高度
const layout = await page.evaluate(() => {
  const paper = document.querySelector('.note-paper')
  const shell = document.querySelector('.editor-scroll.note-shell')
  const scroll = document.querySelector('.note-body-scroll')
  if (!paper || !shell || !scroll) return null
  const paperRect = paper.getBoundingClientRect()
  const scrollRect = scroll.getBoundingClientRect()
  return {
    paperWidth: paperRect.width,
    paperHeight: paperRect.height,
    viewportHeight: window.innerHeight,
    shellOverflow: getComputedStyle(shell).overflowY,
    scrollOverflow: getComputedStyle(scroll).overflowY,
    scrollRight: scrollRect.right,
    paperRight: paperRect.right,
    paperBorderRight: getComputedStyle(paper).borderRightWidth,
  }
})
assert.ok(layout, '未找到笔记固定布局容器')
assert.ok(layout.paperWidth >= 1050, `纸张宽度不足：${layout.paperWidth}`)
assert.ok(layout.paperHeight < layout.viewportHeight - 80, '纸张高度未固定')
assert.equal(layout.shellOverflow, 'hidden')
assert.equal(layout.scrollOverflow, 'auto')
assert.ok(
  Math.abs(layout.scrollRight - (layout.paperRight - parseFloat(layout.paperBorderRight))) <= 2,
  `滚动条没有紧贴纸张右侧：${layout.scrollRight} vs ${layout.paperRight}`,
)

// 2. 新建空文档，测试点击空白区与单位块
const adds = await page.$$('.section-add')
await adds[0].click()
await page.waitForSelector('.popup-menu')
const menuButtons = await page.$$('.popup-menu button')
await menuButtons[0].click()
await page.waitForSelector('.dialog input')
await page.$eval('.dialog input', (input) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, '中栏布局测试')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const dialogButtons = await page.$$('.dialog-actions button')
await dialogButtons[1].click()
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '中栏布局测试')
await page.waitForFunction(() => document.querySelectorAll('.note-prose > p').length === 1)

assert.equal(await countParagraphs(), 1)

// 点击空白区：最后一块为空 -> 只聚焦，不重复新增
await page.click('.note-add-space')
await new Promise((resolve) => setTimeout(resolve, 100))
assert.equal(await countParagraphs(), 1, '空块状态点击空白区不应重复新增')
assert.ok(await isEditorFocused(), '点击空白区后编辑器未聚焦')

await page.keyboard.sendCharacter('第一块')
assert.equal(await countParagraphs(), 1)

// 点击空白区：最后一块非空 -> 追加新块
await page.click('.note-add-space')
await new Promise((resolve) => setTimeout(resolve, 100))
assert.equal(await countParagraphs(), 2, '点击空白区未追加新块')
assert.ok(await isEditorFocused(), '追加后编辑器未聚焦')
await page.keyboard.sendCharacter('第二块')

// Enter：新建单位块
await page.keyboard.press('Enter')
await page.keyboard.sendCharacter('第三块')
assert.equal(await countParagraphs(), 3, 'Enter 未创建新的单位块')

// Shift+Enter：同一块内换行，块数量不变
await page.keyboard.down('Shift')
await page.keyboard.press('Enter')
await page.keyboard.up('Shift')
await page.keyboard.sendCharacter('块内换行')
assert.equal(await countParagraphs(), 3, 'Shift+Enter 不应新增块')

const blockState = await page.evaluate(() => {
  const paragraphs = [...document.querySelectorAll('.note-prose > p')]
  const last = paragraphs[paragraphs.length - 1]
  return {
    paragraphCount: paragraphs.length,
    lastHtml: last?.innerHTML ?? '',
    lastText: last?.textContent ?? '',
  }
})
assert.ok(blockState.lastHtml.includes('<br>'), 'Shift+Enter 未生成块内换行')
assert.ok(blockState.lastText.includes('第三块块内换行'))

const fixedHeightBefore = await page.$eval('.note-paper', (el) => el.getBoundingClientRect().height)

// 3. 内容撑高后，仅正文内部滚动
for (let index = 0; index < 30; index += 1) {
  await page.keyboard.press('Enter')
  await page.keyboard.sendCharacter(`填充行 ${index + 1}`)
}

await page.waitForFunction(() => {
  const scroll = document.querySelector('.note-body-scroll')
  return scroll ? scroll.scrollHeight > scroll.clientHeight + 100 : false
})

const overflowState = await page.evaluate(() => {
  const paper = document.querySelector('.note-paper')
  const shell = document.querySelector('.editor-scroll.note-shell')
  const scroll = document.querySelector('.note-body-scroll')
  const paperRect = paper.getBoundingClientRect()
  const scrollRect = scroll.getBoundingClientRect()
  return {
    paperHeight: paperRect.height,
    shellScrollTop: shell.scrollTop,
    shellScrollHeight: shell.scrollHeight,
    shellClientHeight: shell.clientHeight,
    scrollHeight: scroll.scrollHeight,
    clientHeight: scroll.clientHeight,
    scrollbarWidth: scroll.offsetWidth - scroll.clientWidth,
    scrollRight: scrollRect.right,
    paperRight: paperRect.right,
    addedSpace: paperRect.right - scrollRect.right,
  }
})
assert.ok(
  Math.abs(overflowState.paperHeight - fixedHeightBefore) <= 2,
  '正文变长后纸张高度发生变化',
)
assert.ok(overflowState.scrollHeight > overflowState.clientHeight, '正文没有内部滚动')
assert.ok(overflowState.scrollbarWidth > 0, '没有可见滚动条')
assert.ok(overflowState.scrollRight >= overflowState.paperRight - 3, '滚动条未贴住右侧')
assert.ok(overflowState.shellScrollHeight <= overflowState.shellClientHeight + 1, '外层页面出现滚动')

// 点击滚动条轨道：应原生滚动，且不能触发“点击空白追加段落”
await page.$eval('.note-body-scroll', (el) => {
  el.scrollTop = 0
})
await new Promise((resolve) => setTimeout(resolve, 100))
const countBeforeScrollbarClick = await countParagraphs()
const scrollRect = await page.$eval('.note-body-scroll', (el) =>
  el.getBoundingClientRect().toJSON(),
)
await page.mouse.click(scrollRect.right - 6, scrollRect.bottom - 80)
await new Promise((resolve) => setTimeout(resolve, 350))
const scrollbarClickState = await page.evaluate(() => {
  const scroll = document.querySelector('.note-body-scroll')
  return {
    scrollTop: scroll.scrollTop,
    paragraphs: document.querySelectorAll('.note-prose > p').length,
  }
})
assert.equal(
  scrollbarClickState.paragraphs,
  countBeforeScrollbarClick,
  '点击滚动条时不应追加段落',
)
assert.ok(scrollbarClickState.scrollTop > 0, '点击滚动条轨道没有滚动')

// 滚动到底部后点击空白区继续追加
await page.$eval('.note-body-scroll', (el) => {
  el.scrollTop = el.scrollHeight
})
await new Promise((resolve) => setTimeout(resolve, 100))
const countBeforeAdd = await countParagraphs()
await page.click('.note-add-space')
await new Promise((resolve) => setTimeout(resolve, 100))
assert.equal(await countParagraphs(), countBeforeAdd + 1, '滚动到底部后点击空白区未追加块')

await page.screenshot({ path: path.join(shotDir, 'note-layout.png') })
await browser.close()

const results = {
  paperWidth: layout.paperWidth,
  paperHeight: layout.paperHeight,
  scrollbarWidth: overflowState.scrollbarWidth,
  fixedHeightDelta: Math.abs(overflowState.paperHeight - fixedHeightBefore),
  scrollbarClickScrollTop: scrollbarClickState.scrollTop,
  scrollbarClickParagraphs: scrollbarClickState.paragraphs,
  paragraphs: countBeforeAdd + 1,
  consoleErrors: errors,
}
console.log(JSON.stringify(results, null, 2))
if (errors.length) process.exit(1)
console.log('中栏布局与单位块自测全部通过')
