import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5174'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-chrome-math-'))
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-math-dl-'))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir,
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1500, height: 1100 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

async function createNote(name) {
  const adds = await page.$$('.section-add')
  await adds[0].click()
  await page.waitForSelector('.popup-menu')
  const menuButtons = await page.$$('.popup-menu button')
  await menuButtons[0].click()
  await page.waitForSelector('.dialog input')
  await page.$eval(
    '.dialog input',
    (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    name,
  )
  const dialogButtons = await page.$$('.dialog-actions button')
  await dialogButtons[1].click()
  await page.waitForFunction(
    (expected) => document.querySelector('.note-title')?.value === expected,
    {},
    name,
  )
  await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)
}

async function typeSlash(query, expectedTitle) {
  await page.keyboard.type(query)
  await page.waitForFunction(
    (title) => document.querySelector('.slash-item .slash-title')?.textContent === title,
    {},
    expectedTitle,
  )
  await page.keyboard.press('Enter')
}

async function editMath(selector, latex, dialogSelector = '.math-dialog') {
  await page.click(`${selector} .math-render`)
  await page.waitForSelector(dialogSelector, { timeout: 10000 })
  const ocrUi = await page.evaluate((sel) => {
    const dialog = document.querySelector(sel)
    return {
      button: dialog?.querySelector('.math-ocr-btn')?.textContent?.trim() ?? '',
      fileInput: Boolean(dialog?.querySelector('input[type="file"][accept="image/*"]')),
    }
  }, dialogSelector)
  assert.ok(
    ocrUi.button.includes('上传图片识别'),
    `公式编辑弹窗缺少图片识别按钮：${JSON.stringify(ocrUi)}`,
  )
  assert.ok(ocrUi.fileInput, '公式编辑弹窗缺少图片文件输入')
  await page.type(`${dialogSelector} textarea`, latex)
  await page.click(`${dialogSelector} .btn.primary`)
  await page.waitForFunction(
    (sel) => !document.querySelector(sel),
    {},
    dialogSelector,
  )
}

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.paper')

  await createNote('公式测试')
  await page.click('.ProseMirror')

  // 行内公式：斜杠命令插入后编辑
  await typeSlash('/gongshi', '行内公式')
  await page.waitForSelector('.math-node.math-inline', { timeout: 10000 })
  const emptyHint = await page.$eval('.math-node.math-inline .math-empty', (el) => el.textContent)
  assert.ok(emptyHint?.includes('点击编辑公式'), `空公式提示不对：${emptyHint}`)

  await editMath('.math-node.math-inline', 'E=mc^2')
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector('.math-inline[data-latex="E=mc^2"]')) &&
      Boolean(document.querySelector('.math-inline .katex')),
    { timeout: 10000 },
  )

  // 块级公式（编辑弹窗关闭后焦点丢失，先重新聚焦编辑器）
  await page.evaluate(() => document.querySelector('.ProseMirror')?.focus())
  await page.keyboard.press('Enter')
  await typeSlash('/kuangongshi', '块级公式')
  await page.waitForSelector('.math-node.math-block', { timeout: 10000 })
  await editMath('.math-node.math-block', '\\int_0^1 x^2\\,dx')
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector('.math-block[data-latex]')) &&
      Boolean(document.querySelector('.math-block .katex')),
    { timeout: 10000 },
  )

  // 行内快捷输入：$x^2$ 自动转公式
  await page.evaluate(() => document.querySelector('.ProseMirror')?.focus())
  await page.keyboard.press('Enter')
  await page.keyboard.type('$x^2$')
  await page.waitForFunction(
    () => Boolean(document.querySelector('.math-inline[data-latex="x^2"]')),
    { timeout: 10000 },
  )

  // 刷新后公式持久化
  await page.waitForFunction(
    () => document.querySelector('.save-state')?.textContent === '已保存',
    { timeout: 15000 },
  )
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '公式测试',
    { timeout: 20000 },
  )
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.math-node').length === 3 &&
      Boolean(document.querySelector('.math-inline[data-latex="E=mc^2"] .katex')) &&
      Boolean(document.querySelector('.math-block .katex')) &&
      Boolean(document.querySelector('.math-inline[data-latex="x^2"]')),
    { timeout: 20000 },
  )

  // Markdown 导出保留 LaTeX 源
  const client = await page.createCDPSession()
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })
  await page.click('button[title="导出"]')
  await page.waitForSelector('.topbar-menu')
  for (const item of await page.$$('.topbar-menu button')) {
    const label = await item.evaluate((el) => el.textContent ?? '')
    if (label.includes('单文件')) {
      await item.click()
      break
    }
  }
  let markdownPath = ''
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const files = fs.readdirSync(downloadDir).filter((file) => file.endsWith('.md'))
    if (files.length > 0) {
      markdownPath = path.join(downloadDir, files[0])
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  assert.ok(markdownPath, '未收到 Markdown 导出文件')
  const markdown = fs.readFileSync(markdownPath, 'utf8')
  assert.ok(markdown.includes('E=mc^2'), `行内公式未导出 LaTeX：${markdown}`)
  assert.ok(markdown.includes('\\int_0^1 x^2\\,dx'), '块级公式未导出 LaTeX')
  assert.ok(markdown.includes('$$'), '块级公式缺少 $$ 围栏')

  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  const summary = await page.evaluate(() => ({
    inlineLatex: document
      .querySelector('.math-inline[data-latex="E=mc^2"]')
      ?.getAttribute('data-latex'),
    blockRendered: Boolean(document.querySelector('.math-block .katex')),
    inputRuleLatex: document
      .querySelector('.math-inline[data-latex="x^2"]')
      ?.getAttribute('data-latex'),
    mathCount: document.querySelectorAll('.math-node').length,
  }))

  console.log(JSON.stringify({ ...summary, consoleErrors: errors }, null, 2))
  console.log('LaTeX 公式自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
  fs.rmSync(downloadDir, { recursive: true, force: true })
}
