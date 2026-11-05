import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5174'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-chrome-sidebar-collapse-'))

const now = Date.now()
const tree = [
  {
    id: 'folder-a',
    area: 'space',
    parentId: null,
    kind: 'folder',
    name: '资料',
    order: 'a1',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-in-folder',
    area: 'space',
    parentId: 'folder-a',
    kind: 'doc',
    name: '文件夹里的文档',
    order: 'a1',
    docType: 'md',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-root',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '根文档',
    order: 'a2',
    docType: 'md',
    createdAt: now,
    updatedAt: now,
  },
]

const contentRoot = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'root' }] }],
}
const contentInFolder = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inside' }] }],
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir,
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1440, height: 900 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

async function keyExists(key) {
  return page.evaluate(
    (k) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('keyval-store')
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('keyval', 'readonly')
          const get = tx.objectStore('keyval').get(k)
          get.onsuccess = () => resolve(get.result != null)
          get.onerror = () => reject(get.error)
        }
        req.onerror = () => reject(req.error)
      }),
    key,
  )
}

async function seed() {
  await page.evaluate(
    async ({ nodes, root, inside, active }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('keyval-store')
        req.onupgradeneeded = () => req.result.createObjectStore('keyval')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      await new Promise((resolve, reject) => {
        const tx = db.transaction('keyval', 'readwrite')
        const store = tx.objectStore('keyval')
        store.clear()
        store.put(nodes, 'ainb.tree.v2')
        store.put(root, 'ainb.node.doc-root')
        store.put(inside, 'ainb.node.doc-in-folder')
        tx.oncomplete = () => {
          localStorage.setItem('ainb.active.v1', active)
          resolve(true)
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { nodes: tree, root: contentRoot, inside: contentInFolder, active: 'doc-root' },
  )
}

async function folderState(name) {
  return page.evaluate((folderName) => {
    const row = [...document.querySelectorAll('.tree-row')].find(
      (item) => item.querySelector('.row-name')?.textContent?.trim() === folderName,
    )
    return {
      expanded: row?.querySelector('.chevron-btn')?.getAttribute('aria-expanded') ?? null,
      names: [...document.querySelectorAll('.row-name')].map(
        (el) => el.textContent?.trim() ?? '',
      ),
    }
  }, name)
}

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.sidebar')
  for (let i = 0; i < 200; i += 1) {
    if ((await keyExists('ainb.assetRefs.v1')) && (await keyExists('ainb.searchIndex.v1'))) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  await seed()
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '根文档',
    { timeout: 20000 },
  )
  await page.waitForSelector('.tree-row')

  // 默认收起：文件夹 chevron 为收起，子文档不渲染
  const initial = await folderState('资料')
  assert.equal(initial.expanded, 'false', `文件夹应默认收起：${JSON.stringify(initial)}`)
  assert.ok(!initial.names.includes('文件夹里的文档'), '收起时不应渲染子文档')

  // 手动展开后子文档出现
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(
      (item) => item.querySelector('.row-name')?.textContent?.trim() === '资料',
    )
    row?.querySelector('.chevron-btn')?.click()
  })
  await page.waitForFunction(
    () => {
      const row = [...document.querySelectorAll('.tree-row')].find(
        (item) => item.querySelector('.row-name')?.textContent?.trim() === '资料',
      )
      const expanded = row?.querySelector('.chevron-btn')?.getAttribute('aria-expanded')
      const names = [...document.querySelectorAll('.row-name')].map((el) =>
        el.textContent?.trim(),
      )
      return expanded === 'true' && names.includes('文件夹里的文档')
    },
    { timeout: 5000 },
  )

  // 刷新后仍收起
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.tree-row')
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '根文档',
    { timeout: 20000 },
  )
  const afterReload = await folderState('资料')
  assert.equal(afterReload.expanded, 'false', `刷新后文件夹仍应收起：${JSON.stringify(afterReload)}`)
  assert.ok(!afterReload.names.includes('文件夹里的文档'), '刷新后收起时不应渲染子文档')

  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  console.log(
    JSON.stringify(
      {
        initialCollapsed: initial.expanded,
        initialChildrenHidden: !initial.names.includes('文件夹里的文档'),
        afterReloadCollapsed: afterReload.expanded,
        afterReloadChildrenHidden: !afterReload.names.includes('文件夹里的文档'),
        consoleErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log('侧栏文件夹默认收起自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
