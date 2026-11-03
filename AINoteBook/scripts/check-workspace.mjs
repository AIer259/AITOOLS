import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

const now = Date.now()
const tree = [
  {
    id: 'folder-heima',
    area: 'space',
    parentId: null,
    kind: 'folder',
    name: '黑马程序员',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'folder-vibe',
    area: 'space',
    parentId: 'folder-heima',
    kind: 'folder',
    name: 'vibecoding',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-nav',
    area: 'space',
    parentId: 'folder-vibe',
    kind: 'doc',
    name: '导航测试文档',
    docType: 'md',
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '导航测试内容' }] },
      ],
    },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-root',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '根目录文档',
    docType: 'md',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '根目录内容' }] }],
    },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'folder-private',
    area: 'private',
    parentId: null,
    kind: 'folder',
    name: '私人资料',
    createdAt: now,
    updatedAt: now,
  },
]

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-workspace-'))
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

async function breadcrumb() {
  return page.$$eval('.breadcrumb .crumb', (items) =>
    items.map((item) => item.textContent?.trim() ?? ''),
  )
}

async function workspaceItems() {
  return page.$$eval('.workspace-item-name', (items) =>
    items.map((item) => item.textContent?.trim() ?? ''),
  )
}

async function clickByText(selector, text) {
  await page.evaluate(
    ({ selector: target, text: label }) => {
      const elements = [...document.querySelectorAll(target)]
      const element = elements.find((item) => item.textContent?.trim() === label)
      element?.click()
    },
    { selector, text },
  )
}

async function clickWorkspaceItem(name) {
  await page.evaluate((label) => {
    const item = [...document.querySelectorAll('.workspace-item')].find(
      (element) => element.querySelector('.workspace-item-name')?.textContent?.trim() === label,
    )
    item?.click()
  }, name)
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
    localStorage.setItem('ainb.active.v1', 'doc-nav')
  }, tree)

  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '导航测试文档',
  )
  assert.deepEqual(await breadcrumb(), ['空间', '黑马程序员', 'vibecoding', '导航测试文档'])

  await clickByText('.section-title', '空间')
  await page.waitForSelector('.workspace-view')
  assert.deepEqual(await breadcrumb(), ['空间'])
  assert.deepEqual(await workspaceItems(), ['黑马程序员', '根目录文档'])

  await clickWorkspaceItem('黑马程序员')
  await page.waitForFunction(
    () => document.querySelector('.workspace-item-name')?.textContent === 'vibecoding',
  )
  assert.deepEqual(await breadcrumb(), ['空间', '黑马程序员'])
  assert.deepEqual(await workspaceItems(), ['vibecoding'])

  await clickWorkspaceItem('vibecoding')
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.workspace-item-name')].some(
        (item) => item.textContent === '导航测试文档',
      ),
  )
  assert.deepEqual(await breadcrumb(), ['空间', '黑马程序员', 'vibecoding'])
  assert.deepEqual(await workspaceItems(), ['导航测试文档'])

  await clickWorkspaceItem('导航测试文档')
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '导航测试文档',
  )
  assert.deepEqual(await breadcrumb(), ['空间', '黑马程序员', 'vibecoding', '导航测试文档'])

  await clickByText('.crumb-button', '黑马程序员')
  await page.waitForSelector('.workspace-view')
  await page.waitForFunction(
    () => document.querySelector('.workspace-item-name')?.textContent === 'vibecoding',
  )
  assert.deepEqual(await breadcrumb(), ['空间', '黑马程序员'])

  await clickByText('.crumb-button', '空间')
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.workspace-item-name')].some(
        (item) => item.textContent === '黑马程序员',
      ),
  )
  assert.deepEqual(await breadcrumb(), ['空间'])

  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(
      (item) => item.querySelector('.row-name')?.textContent === '黑马程序员',
    )
    row?.click()
  })
  await page.waitForFunction(
    () => document.querySelector('.workspace-item-name')?.textContent === 'vibecoding',
  )
  const browsingRow = await page.$eval('.tree-row.is-browsing .row-name', (item) =>
    item.textContent?.trim(),
  )
  assert.equal(browsingRow, '黑马程序员')

  await clickByText('.section-title', '私人')
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.workspace-item-name')].some(
        (item) => item.textContent === '私人资料',
      ),
  )
  assert.deepEqual(await breadcrumb(), ['私人'])

  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '导航测试文档',
  )
  assert.deepEqual(await breadcrumb(), ['空间', '黑马程序员', 'vibecoding', '导航测试文档'])
  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  console.log(
    JSON.stringify(
      {
        breadcrumb: await breadcrumb(),
        workspaceRoot: ['黑马程序员', '根目录文档'],
        browsingRow,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log('工作区浏览与面包屑自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
