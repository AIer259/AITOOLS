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
  userDataDir: path.resolve(`.tmp-chrome-callout-${Date.now()}`),
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
  setter?.call(input, '着重测试')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForFunction(() => document.querySelector('.dialog input')?.value === '着重测试')
await new Promise((resolve) => setTimeout(resolve, 150))
const dialogButtons = await page.$$('.dialog-actions button')
for (const button of dialogButtons) {
  const text = await button.evaluate((el) => el.textContent ?? '')
  if (text.includes('创建')) {
    await button.click()
    break
  }
}
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '着重测试')
await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)

// 斜杠菜单：/zhuozhong 命中并插入
await page.click('.ProseMirror')
await page.keyboard.type('/zhuozhong')
await page.waitForSelector('.slash-menu')
const firstItem = await page.$eval('.slash-item .slash-title', (el) => el.textContent)
assert.equal(firstItem, '着重块', '全拼查询没有把着重块排在首项')
await page.keyboard.press('Enter')
await page.waitForSelector('.note-prose [data-callout]')
await page.waitForSelector('.note-callout-body > p.is-empty')

const placeholder = await page.$eval(
  '.note-callout-body > p',
  (el) => getComputedStyle(el, '::before').content,
)
assert.ok(placeholder.includes('着重块'), '着重块空行没有显示占位文字')

// 块内输入两段
await typeText('这是重点')
await page.waitForFunction(() =>
  document.querySelector('[data-callout]')?.textContent.includes('这是重点'),
)
await page.keyboard.press('Enter')
await typeText('第二行')
await page.waitForFunction(() =>
  document.querySelector('[data-callout]')?.textContent.includes('第二行'),
)

const styleState = await page.evaluate(() => {
  const callout = document.querySelector('.note-prose [data-callout]')
  const icon = callout.querySelector('.note-callout-icon')
  const body = callout.querySelector('.note-callout-body')
  const calloutRect = callout.getBoundingClientRect()
  const iconRect = icon.getBoundingClientRect()
  const bodyRect = body.getBoundingClientRect()
  const style = getComputedStyle(callout)
  const anchor = window.getSelection()?.anchorNode
  const anchorElement =
    anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement
  return {
    calloutCount: document.querySelectorAll('.note-prose [data-callout]').length,
    iconText: icon.textContent.trim(),
    iconEditable: icon.getAttribute('contenteditable'),
    borderWidth: style.borderTopWidth,
    borderStyle: style.borderTopStyle,
    borderRadius: style.borderRadius,
    display: style.display,
    backgroundColor: style.backgroundColor,
    iconTop: Math.round(iconRect.top - calloutRect.top),
    iconLeft: Math.round(iconRect.left - calloutRect.left),
    iconRight: Math.round(iconRect.right),
    bodyLeft: Math.round(bodyRect.left),
    paragraphs: callout.querySelectorAll('.note-callout-body > p').length,
    text: callout.textContent,
    activeInside: Boolean(anchorElement?.closest('[data-callout]')),
    editorFocused: Boolean(document.activeElement?.classList.contains('ProseMirror')),
  }
})

assert.equal(styleState.calloutCount, 1, '没有生成唯一的着重块')
assert.ok(styleState.iconText.includes('💡'), '左上角缺少注意图标')
assert.equal(styleState.iconEditable, 'false', '图标不应可编辑')
assert.equal(styleState.borderWidth, '1px', '着重块没有边框')
assert.equal(styleState.borderStyle, 'solid')
assert.equal(styleState.borderRadius, '10px')
assert.equal(styleState.display, 'flex')
assert.notEqual(styleState.backgroundColor, 'rgba(0, 0, 0, 0)', '着重块没有背景色')
assert.ok(styleState.iconTop >= 8 && styleState.iconTop <= 20, '图标没有位于左上角')
assert.ok(styleState.iconLeft >= 8 && styleState.iconLeft <= 20, '图标没有位于左上角')
assert.ok(styleState.bodyLeft > styleState.iconRight, '正文没有排在图标右侧')
assert.equal(styleState.paragraphs, 2, 'Enter 没有在着重块内创建新段落')
assert.ok(styleState.text.includes('这是重点') && styleState.text.includes('第二行'))
assert.ok(styleState.activeInside, '输入后光标不在着重块内')
assert.ok(styleState.editorFocused, '输入后编辑器没有保持焦点')

const firstBackground = styleState.backgroundColor
const firstTheme = await page.evaluate(() => document.documentElement.dataset.theme)
await page.screenshot({ path: path.join(shotDir, 'callout-theme-1.png') })

// 切换主题后背景应变化
await page.click('.theme-toggle')
await page.waitForFunction(
  (theme) => document.documentElement.dataset.theme !== theme,
  {},
  firstTheme,
)
const secondTheme = await page.evaluate(() => document.documentElement.dataset.theme)
const secondBackground = await page.$eval(
  '.note-prose [data-callout]',
  (el) => getComputedStyle(el).backgroundColor,
)
assert.notEqual(secondBackground, firstBackground, '切换主题没有应用着重块背景')
await page.screenshot({ path: path.join(shotDir, 'callout-theme-2.png') })
await page.click('.theme-toggle')
await page.waitForFunction(
  (theme) => document.documentElement.dataset.theme !== theme,
  {},
  secondTheme,
)

// 三种查询规则
const matches = await page.evaluate(async () => {
  const { filterSlashItems } = await import('/src/lib/slashCommands.ts')
  return ['着重', 'zhuozhong', 'zzk'].map((query) => ({
    query,
    first: filterSlashItems(query)[0]?.title ?? '',
  }))
})
for (const match of matches) {
  assert.equal(match.first, '着重块', `查询 ${match.query} 没有命中着重块`)
}

// 嵌套预览的只读 HTML
const previewHtml = await page.evaluate(async () => {
  const { docJsonToHtml } = await import('/src/lib/renderDoc.ts')
  return docJsonToHtml({
    type: 'doc',
    content: [
      {
        type: 'callout',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '预览重点' }] },
        ],
      },
    ],
  })
})
assert.ok(previewHtml.includes('data-callout'), '嵌套预览没有渲染着重块')
assert.ok(previewHtml.includes('note-callout-icon'), '嵌套预览缺少图标')
assert.ok(previewHtml.includes('预览重点'), '嵌套预览缺少内容')

// 等待防抖保存完成后再刷新
await page.waitForFunction(() =>
  document.querySelector('.save-state')?.textContent?.includes('已保存'),
)
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '着重测试')
await page.waitForSelector('.note-prose [data-callout]')
const persistedText = await page.$eval('.note-prose [data-callout]', (el) => el.textContent)
assert.ok(persistedText.includes('这是重点'), '刷新后着重块内容丢失')

// Markdown 导出为引用块
await clickExport('单文件')
const mdPath = await waitForDownload('.md')
const markdown = fs.readFileSync(mdPath, 'utf8')
assert.ok(/^> 💡/m.test(markdown), 'Markdown 没有导出 💡 引用块')
assert.ok(markdown.includes('这是重点') && markdown.includes('第二行'))
assert.ok(!markdown.includes('data-callout'), 'Markdown 残留着重块 HTML')

// PDF 直接下载保留着重块
await clickExport('直接下载')
const pdfPath = await waitForDownload('.pdf')
const pdfBuffer = fs.readFileSync(pdfPath)
assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF')
assert.ok(pdfBuffer.length > 10000, 'PDF 文件过小')

await browser.close()

const results = {
  slashMatch: matches,
  callout: {
    icon: styleState.iconText,
    border: `${styleState.borderWidth} ${styleState.borderStyle}`,
    radius: styleState.borderRadius,
    paragraphs: styleState.paragraphs,
    firstTheme,
    firstBackground,
    secondTheme,
    secondBackground,
  },
  markdownBytes: Buffer.byteLength(markdown),
  pdfBytes: pdfBuffer.length,
  consoleErrors: errors,
}
console.log(JSON.stringify(results, null, 2))
if (errors.length) process.exit(1)
console.log('着重块自测全部通过')
