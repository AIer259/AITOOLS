import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5174'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-chrome-search-replace-'))

const now = Date.now()
const contentA = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'apple banana apple' }] }],
}
const longParagraphs = Array.from({ length: 50 }, (_, i) => ({
  type: 'paragraph',
  content: [{ type: 'text', text: i === 25 ? 'target keyword here' : `filler paragraph ${i}` }],
}))
const contentB = { type: 'doc', content: longParagraphs }

const tree = [
  {
    id: 'doc-a',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '搜索替换测试',
    order: 'a1',
    docType: 'md',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-b',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '长文档',
    order: 'a2',
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
  defaultViewport: { width: 1440, height: 900 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

async function setInput(selector, value) {
  await page.evaluate(
    (sel, val) => {
      const input = document.querySelector(sel)
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, val)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    selector,
    value,
  )
}

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
    async ({ nodes, contentDocA, contentDocB, active }) => {
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
        store.put(contentDocA, 'ainb.node.doc-a')
        store.put(contentDocB, 'ainb.node.doc-b')
        tx.oncomplete = () => {
          localStorage.setItem('ainb.active.v1', active)
          resolve(true)
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { nodes: tree, contentDocA: contentA, contentDocB: contentB, active: 'doc-a' },
  )
}

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.sidebar')
  // 等首次启动的索引扫描完成，避免清库后被回写标记
  await page.waitForFunction(() => true)
  // 用 keyExists 轮询索引标记
  for (let i = 0; i < 200; i += 1) {
    if ((await keyExists('ainb.assetRefs.v1')) && (await keyExists('ainb.searchIndex.v1'))) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  await seed()
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '搜索替换测试',
    { timeout: 20000 },
  )
  await page.waitForFunction(
    () => document.querySelector('.note-prose')?.textContent?.includes('apple banana apple'),
    { timeout: 20000 },
  )

  // 打开文档内搜索并输入查询
  await page.click('button[title="搜索当前文档"]')
  await page.waitForSelector('.search-panel')
  await setInput('.search-panel input', 'apple')
  await page.waitForFunction(
    () => document.querySelector('.search-count')?.textContent === '1/2',
    { timeout: 10000 },
  )
  const hitCount = await page.$$eval('.search-hit', (els) => els.length)
  assert.equal(hitCount, 2, `高亮数量不对：${hitCount}`)

  // 替换行出现，输入替换词
  await page.waitForSelector('.search-panel-replace')
  await setInput('.search-panel-replace input', 'pear')

  // 单个替换：count 2 → 1
  await page.click('.search-replace-btn')
  await page.waitForFunction(
    () => document.querySelector('.search-count')?.textContent === '1/1',
    { timeout: 10000 },
  )

  // 全部替换：count 1 → 0
  const replaceButtons = await page.$$('.search-replace-btn')
  await replaceButtons[1].click()
  await page.waitForFunction(
    () => document.querySelector('.search-count')?.textContent === '无结果',
    { timeout: 10000 },
  )

  const replacedText = await page.$eval('.note-prose', (el) => el.textContent ?? '')
  assert.ok(replacedText.includes('pear banana pear'), `替换后正文不对：${replacedText}`)

  // 替换为空（删除匹配）
  await setInput('.search-panel input', 'banana')
  await page.waitForFunction(
    () => document.querySelector('.search-count')?.textContent === '1/1',
    { timeout: 10000 },
  )
  await setInput('.search-panel-replace input', '')
  await page.click('.search-replace-btn')
  await page.waitForFunction(
    () => document.querySelector('.search-count')?.textContent === '无结果',
    { timeout: 10000 },
  )
  const deletedText = await page.$eval('.note-prose', (el) => el.textContent ?? '')
  assert.ok(!deletedText.includes('banana'), `替换为空未删除匹配：${deletedText}`)

  // 关闭当前文档搜索，准备全局搜索定位测试
  await page.click('.search-icon-btn[title="关闭搜索"]')
  await page.waitForFunction(() => !document.querySelector('.search-panel'))

  // 全局搜索跳转到长文档，验证关闭文档内搜索后不跳到文档末
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  })
  await page.waitForSelector('.global-search-dialog')
  await setInput('.global-search-input', 'target')
  await page.waitForFunction(
    () => document.querySelectorAll('.global-search-result').length === 1,
    { timeout: 15000 },
  )
  await page.click('.global-search-result')
  await page.waitForFunction(
    () =>
      document.querySelector('.note-title')?.value === '长文档' &&
      Boolean(document.querySelector('.search-panel')) &&
      Boolean(document.querySelector('.search-hit.current')),
    { timeout: 20000 },
  )

  // 关闭文档内搜索，验证滚动位置停留在匹配处（未跳到底部）
  await page.click('.search-icon-btn[title="关闭搜索"]')
  await page.waitForFunction(() => !document.querySelector('.search-panel'))
  await new Promise((resolve) => setTimeout(resolve, 400))
  const scroll = await page.$eval('.note-body-scroll', (el) => ({
    top: el.scrollTop,
    max: el.scrollHeight - el.clientHeight,
  }))
  assert.ok(scroll.max > 0, `文档未产生滚动，无法验证定位：${JSON.stringify(scroll)}`)
  assert.ok(
    scroll.top < scroll.max,
    `关闭搜索后跳到了文档末：top=${scroll.top} max=${scroll.max}`,
  )

  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  console.log(
    JSON.stringify(
      {
        searchCount: '1/2',
        highlightCount: hitCount,
        replaceCurrent: '1/1',
        replaceAll: '无结果',
        replacedText,
        replaceEmpty: deletedText,
        globalSearchStay: { top: scroll.top, max: scroll.max },
        consoleErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log('搜索替换与全局定位自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
