import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5174'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-chrome-toc-spy-'))

const now = Date.now()

function section(title) {
  return [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
    ...Array.from({ length: 14 }, (_, i) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `${title} 段落 ${i}` }],
    })),
  ]
}
const content = {
  type: 'doc',
  content: [...section('第一节'), ...section('第二节'), ...section('第三节')],
}

const tree = [
  {
    id: 'toc-spy-doc',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '目录定位测试',
    order: 'a1',
    docType: 'md',
    createdAt: now,
    updatedAt: now,
  },
]

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
    async ({ nodes, docContent, active }) => {
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
        store.put(docContent, 'ainb.node.toc-spy-doc')
        tx.oncomplete = () => {
          localStorage.setItem('ainb.active.v1', active)
          resolve(true)
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { nodes: tree, docContent: content, active: 'toc-spy-doc' },
  )
}

async function activeTocText() {
  return page.evaluate(
    () => document.querySelector('.toc-item.active')?.textContent?.trim() ?? null,
  )
}

async function scrollToHeading(index) {
  await page.evaluate((i) => {
    const box = document.querySelector('.note-body-scroll')
    const headings = [...document.querySelectorAll('.note-prose h1')]
    const target = headings[i]
    if (!box || !target) return
    const boxTop = box.getBoundingClientRect().top
    const targetTop = target.getBoundingClientRect().top
    box.scrollTop += targetTop - boxTop - 20
  }, index)
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
    () => document.querySelector('.note-title')?.value === '目录定位测试',
    { timeout: 20000 },
  )
  await page.waitForFunction(() => document.querySelectorAll('.note-prose h1').length === 3, {
    timeout: 20000,
  })

  // 打开目录
  await page.click('button[title="展开目录"]')
  await page.waitForSelector('.toc-panel')
  await page.waitForFunction(() => document.querySelectorAll('.toc-item').length === 3, {
    timeout: 10000,
  })

  // 滚动到第二节，目录高亮应跟随到「第二节」
  await scrollToHeading(1)
  await page.waitForFunction(
    () => document.querySelector('.toc-item.active')?.textContent?.trim() === '第二节',
    { timeout: 5000 },
  )
  const atSecond = await activeTocText()

  // 滚动到第三节，高亮跟随到「第三节」
  await scrollToHeading(2)
  await page.waitForFunction(
    () => document.querySelector('.toc-item.active')?.textContent?.trim() === '第三节',
    { timeout: 5000 },
  )
  const atThird = await activeTocText()

  // 滚动回第二节，高亮回到「第二节」（验证可回退，而非只增不减）
  await scrollToHeading(1)
  await page.waitForFunction(
    () => document.querySelector('.toc-item.active')?.textContent?.trim() === '第二节',
    { timeout: 5000 },
  )

  assert.equal(atSecond, '第二节')
  assert.equal(atThird, '第三节')
  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  console.log(
    JSON.stringify(
      {
        scrollToSecond: atSecond,
        scrollToThird: atThird,
        scrollBackSecond: await activeTocText(),
        consoleErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log('目录滚动定位自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
