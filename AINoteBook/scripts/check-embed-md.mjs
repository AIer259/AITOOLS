import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const mdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-embed-md-'))
const mdPath = path.join(mdDir, 'embed-sample.md')
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-chrome-embed-md-'))

fs.writeFileSync(
  mdPath,
  [
    '# 嵌入的马克笔记',
    '',
    '这是一段 **嵌入 Markdown** 测试内容。',
    '',
    '- 列表甲',
    '- 列表乙',
    '',
    '```python',
    'def answer():',
    '    return 42',
    '```',
    '',
  ].join('\n'),
)

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
  await page.$eval('.dialog input', (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, name)
  const dialogButtons = await page.$$('.dialog-actions button')
  await dialogButtons[1].click()
  await page.waitForFunction((expected) => document.querySelector('.note-title')?.value === expected, {}, name)
  await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)
}

async function openEmbedPicker() {
  const clicked = await page.evaluateHandle(() => {
    const root = document.querySelector('.note-prose')
    if (!root) return null
    const paragraphs = [...root.querySelectorAll(':scope > p')]
    return paragraphs[paragraphs.length - 1] ?? root
  })
  const element = clicked.asElement()
  assert.ok(element, '找不到末尾段落')
  await element.click()
  await page.keyboard.type('/embed')
  await page.waitForFunction(
    () => document.querySelector('.slash-item .slash-title')?.textContent === '嵌入文档',
  )
  await page.keyboard.press('Enter')
  await page.waitForSelector('.embed-picker')
}

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.paper')

  await createNote('嵌入Markdown测试')

  await openEmbedPicker()
  const fileInput = await page.$('.embed-picker input[type="file"]')
  assert.ok(fileInput, '嵌入弹窗缺少文件输入')
  const accept = await fileInput.evaluate((el) => el.accept)
  assert.ok(accept.includes('.md'), `文件框未接受 .md：${accept}`)

  await fileInput.uploadFile(mdPath)
  await page.waitForFunction(() => !document.querySelector('.embed-picker'), { timeout: 20000 })
  await page.waitForFunction(() => document.querySelectorAll('.embed-node').length === 1, {
    timeout: 20000,
  })

  const card = await page.evaluate(() => ({
    name: document.querySelector('.embed-node .embed-name')?.textContent,
    badge: document.querySelector('.embed-node .embed-badge')?.textContent,
  }))
  assert.equal(card.name, 'embed-sample', `嵌入名称不对：${card.name}`)
  assert.equal(card.badge, 'Markdown', `嵌入类型不对：${card.badge}`)

  await page.click('.embed-node .embed-main')
  await page.waitForSelector('.embed-node .embed-md')
  const preview = await page.evaluate(() => {
    const root = document.querySelector('.embed-node .embed-md')
    return {
      text: root?.textContent ?? '',
      heading: root?.querySelector('h1')?.textContent ?? '',
      items: [...(root?.querySelectorAll('li') ?? [])].map((el) => el.textContent?.trim()),
      code: root?.querySelector('pre code')?.textContent ?? '',
    }
  })
  assert.equal(preview.heading, '嵌入的马克笔记', 'Markdown 标题未渲染')
  assert.ok(preview.text.includes('嵌入 Markdown'), 'Markdown 正文未渲染')
  assert.deepEqual(preview.items, ['列表甲', '列表乙'], 'Markdown 列表未渲染')
  assert.ok(preview.code.includes('def answer'), 'Markdown 代码块未渲染')

  const attachmentChevron = '.tree-row[title="嵌入Markdown测试附件"] .chevron-btn'
  const attachmentExpanded = await page.$eval(
    attachmentChevron,
    (el) => el.getAttribute('aria-expanded') === 'true',
  )
  if (!attachmentExpanded) await page.click(attachmentChevron)
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.tree-row')].some((el) =>
        el.textContent?.includes('embed-sample'),
      ),
    { timeout: 10000 },
  )

  const treeHasDoc = await page.evaluate(() =>
    [...document.querySelectorAll('.tree-row')].some((el) =>
      el.textContent?.includes('embed-sample'),
    ),
  )
  assert.ok(treeHasDoc, '上传的 Markdown 未出现在文件树')

  await page.waitForFunction(
    () => document.querySelector('.save-state')?.textContent === '已保存',
    { timeout: 10000 },
  )
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.paper')
  try {
    await page.waitForFunction(() => document.querySelectorAll('.embed-node').length === 1)
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      title: document.querySelector('.note-title')?.value,
      embedCount: document.querySelectorAll('.embed-node').length,
      tree: [...document.querySelectorAll('.tree-row')].map((el) => el.textContent?.trim()),
      body: document.querySelector('.note-prose')?.textContent?.slice(0, 120),
    }))
    console.error('刷新后状态', snapshot)
    throw error
  }
  await page.click('.embed-node .embed-main')
  await page.waitForSelector('.embed-node .embed-md')
  const persisted = await page.$eval('.embed-node .embed-md', (el) => el.textContent ?? '')
  assert.ok(persisted.includes('嵌入 Markdown'), '刷新后嵌入内容丢失')
  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  console.log(
    JSON.stringify(
      { card, preview: { heading: preview.heading, items: preview.items }, treeHasDoc, persisted: true, consoleErrors: errors },
      null,
      2,
    ),
  )
  console.log('嵌入 Markdown 自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(mdDir, { recursive: true, force: true })
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
