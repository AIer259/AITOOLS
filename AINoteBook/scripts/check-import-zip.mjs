import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYQ0AAAAAElFTkSuQmCC'
const png = Buffer.from(PNG_BASE64, 'base64')

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-import-'))
const zipPath = path.join(fixtureDir, '跨电脑导入测试-images.zip')
const mdPath = path.join(fixtureDir, '单文件图片导入.md')

const zip = new JSZip()
zip.file(
  '跨电脑导入测试.md',
  [
    '# 跨电脑导入测试',
    '',
    '这是导入的段落。',
    '',
    '![示例图片](assets/photos/跨电脑导入测试/photo.png)',
    '',
    '图片后的段落。',
    '',
  ].join('\n'),
)
zip.file('assets/photos/跨电脑导入测试/photo.png', png)
fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }))
fs.writeFileSync(
  mdPath,
  [
    '# 单文件图片导入',
    '',
    '这是带 data URI 图片的 Markdown。',
    '',
    `![内嵌图片](data:image/png;base64,${PNG_BASE64})`,
    '',
  ].join('\n'),
)

const now = Date.now()
const tree = [
  {
    id: 'folder-text',
    area: 'space',
    parentId: null,
    kind: 'folder',
    name: 'TEXT',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'folder-private',
    area: 'private',
    parentId: null,
    kind: 'folder',
    name: '黑马程序员',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-old',
    area: 'private',
    parentId: 'folder-private',
    kind: 'doc',
    name: '旧文档',
    docType: 'md',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '旧内容' }] }],
    },
    createdAt: now,
    updatedAt: now,
  },
]

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-chrome-import-'))
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

async function breadcrumb() {
  return page.$$eval('.breadcrumb .crumb', (items) =>
    items.map((item) => item.textContent?.trim() ?? ''),
  )
}

async function assetCount() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store')
      request.onupgradeneeded = () => request.result.createObjectStore('keyval')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readonly')
      const request = tx.objectStore('keyval').get('ainb.assets.meta')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return Array.isArray(value) ? value.length : 0
  })
}

async function waitForImage() {
  await page.waitForSelector('.note-image img', { timeout: 20000 })
  await page.waitForFunction(
    () => {
      const image = document.querySelector('.note-image img')
      return Boolean(image && image.complete && image.naturalWidth > 0)
    },
    { timeout: 20000 },
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
      tx.objectStore('keyval').put(nodes, 'ainb.tree.v1')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    localStorage.setItem('ainb.active.v1', 'doc-old')
  }, tree)

  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('.note-title')?.value === '旧文档')

  await page.click('button[title="导入"]')
  await page.waitForSelector('.topbar-menu')
  const menuItems = await page.$$eval('.topbar-menu button', (items) =>
    items.map((item) => item.textContent?.trim() ?? ''),
  )
  assert.ok(
    menuItems.some((label) => label.includes('Markdown + 图片')),
    `导入菜单缺少 ZIP 入口：${menuItems.join(' / ')}`,
  )
  await page.click('.menu-backdrop')

  // 进入 空间 > TEXT，再导入 ZIP；新文档应出现在当前浏览目录
  await clickByText('.section-title', '空间')
  await page.waitForSelector('.workspace-view')
  assert.deepEqual(await breadcrumb(), ['空间'])
  await clickWorkspaceItem('TEXT')
  await page.waitForFunction(
    () => document.querySelector('.workspace-head h2')?.textContent === 'TEXT',
  )
  assert.deepEqual(await breadcrumb(), ['空间', 'TEXT'])

  const zipInput = await page.$('input[accept*=".zip"]')
  assert.ok(zipInput, '未找到 ZIP 文件输入框')
  await zipInput.uploadFile(zipPath)
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.workspace-item-name')].some(
        (item) => item.textContent === '跨电脑导入测试',
      ),
    { timeout: 30000 },
  )
  assert.deepEqual(await breadcrumb(), ['空间', 'TEXT'])

  await page.waitForFunction(
    () => document.querySelector('.save-state')?.textContent === '已保存',
    { timeout: 10000 },
  )
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '跨电脑导入测试',
  )
  assert.deepEqual(await breadcrumb(), ['空间', 'TEXT', '跨电脑导入测试'])
  await waitForImage()

  const bodyText = await page.$eval('.note-prose', (element) => element.textContent ?? '')
  assert.ok(bodyText.includes('这是导入的段落。'), 'ZIP 导入缺少正文')
  assert.ok(bodyText.includes('图片后的段落。'), 'ZIP 导入图片后的内容缺失')
  assert.ok((await assetCount()) >= 1, 'ZIP 图片未写入资源库')

  const mdInput = await page.$('input[accept*=".md"]')
  assert.ok(mdInput, '未找到 Markdown 文件输入框')
  await mdInput.uploadFile(mdPath)
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '单文件图片导入',
    { timeout: 30000 },
  )
  await waitForImage()
  const mdText = await page.$eval('.note-prose', (element) => element.textContent ?? '')
  assert.ok(mdText.includes('这是带 data URI 图片的 Markdown。'), '单文件导入缺少正文')
  assert.ok((await assetCount()) >= 1, 'data URI 图片未写入资源库')

  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  console.log(
    JSON.stringify(
      {
        zipLocation: ['空间', 'TEXT', '跨电脑导入测试'],
        mdLocation: await breadcrumb(),
        assets: await assetCount(),
        menuItems,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log('Markdown 图片导入与目录定位自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(fixtureDir, { recursive: true, force: true })
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
