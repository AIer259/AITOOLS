import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

const heading = (level, text) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
})

const tree = [
  {
    id: 'toc-default-note',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '目录默认层级测试',
    docType: 'md',
    content: {
      type: 'doc',
      content: [
        heading(1, '一级标题'),
        heading(2, '二级标题'),
        heading(3, '三级标题'),
        heading(4, '四级标题'),
        heading(5, '五级标题'),
      ],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-toc-default-'))
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir,
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1500, height: 1000 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

async function tocItems() {
  return page.$$eval('.toc-item', (items) =>
    items.map((item) => item.textContent?.trim() ?? ''),
  )
}

async function toggle(label) {
  await page.evaluate((text) => {
    const row = [...document.querySelectorAll('.toc-row')].find(
      (item) => item.querySelector('.toc-item')?.textContent?.trim() === text,
    )
    row?.querySelector('.toc-toggle')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, label)
}

async function waitForItems(expected) {
  await page.waitForFunction(
    (names) => {
      const current = [...document.querySelectorAll('.toc-item')].map(
        (item) => item.textContent?.trim() ?? '',
      )
      return JSON.stringify(current) === JSON.stringify(names)
    },
    {},
    expected,
  )
}

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.paper')

  await page.evaluate(async (nodes) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store')
      request.onupgradeneeded = () => request.result.createObjectStore('keyval')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readwrite')
      tx.objectStore('keyval').clear()
      tx.objectStore('keyval').put(nodes, 'ainb.tree.v1')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    localStorage.setItem('ainb.active.v1', 'toc-default-note')
  }, tree)

  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '目录默认层级测试',
  )
  await page.waitForFunction(() => !document.querySelector('button[title="展开目录"]')?.disabled)
  await page.click('button[title="展开目录"]')
  await page.waitForSelector('.toc-panel')
  await page.waitForFunction(() => document.querySelectorAll('.toc-item').length === 2)

  assert.deepEqual(await tocItems(), ['一级标题', '二级标题'])
  const expandedState = await page.$$eval('.toc-toggle', (buttons) =>
    buttons.map((button) => button.getAttribute('aria-expanded')),
  )
  assert.deepEqual(expandedState, ['true', 'false'])

  await toggle('二级标题')
  await waitForItems(['一级标题', '二级标题', '三级标题'])

  await toggle('三级标题')
  await waitForItems(['一级标题', '二级标题', '三级标题', '四级标题'])

  await toggle('四级标题')
  await waitForItems(['一级标题', '二级标题', '三级标题', '四级标题', '五级标题'])

  await toggle('二级标题')
  await waitForItems(['一级标题', '二级标题'])

  // 刷新后仍应保持默认层级，而不是全部展开
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '目录默认层级测试',
  )
  await page.waitForFunction(() => !document.querySelector('button[title="展开目录"]')?.disabled)
  await page.click('button[title="展开目录"]')
  await page.waitForSelector('.toc-panel')
  await page.waitForFunction(() => document.querySelectorAll('.toc-item').length === 2)
  assert.deepEqual(await tocItems(), ['一级标题', '二级标题'])

  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)
  console.log(
    JSON.stringify(
      {
        defaultItems: ['一级标题', '二级标题'],
        expandedState,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log('目录默认折叠层级自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
