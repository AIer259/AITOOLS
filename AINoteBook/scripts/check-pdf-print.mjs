import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

const text = (value) => ({ type: 'text', text: value })
const paragraph = (value) => ({ type: 'paragraph', content: [text(value)] })
const details = (index) => ({
  type: 'details',
  attrs: { open: false },
  content: [
    { type: 'detailsSummary', content: [text(`打印折叠标题 ${index}`)] },
    {
      type: 'detailsContent',
      content: [paragraph(`打印折叠内容 ${index}：默认应该展开显示。`)],
    },
  ],
})

const content = {
  type: 'doc',
  content: Array.from({ length: 3 }, (_, index) => [
    details(index + 1),
    paragraph(`打印折叠块 ${index + 1} 后面的段落。`),
  ]).flat(),
}

const tree = [
  {
    id: 'pdf-print-note',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: 'PDF打印测试',
    docType: 'md',
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-print-check-'))
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
    localStorage.setItem('ainb.active.v1', 'pdf-print-note')
  }, tree)

  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('.note-title')?.value === 'PDF打印测试')

  await page.click('button[title="导出"]')
  await page.waitForSelector('.topbar-menu')
  const items = await page.$$('.topbar-menu button')
  for (const item of items) {
    const label = await item.evaluate((element) => element.textContent ?? '')
    if (label.includes('浏览器打印')) {
      await item.click()
      break
    }
  }

  await page.waitForSelector('iframe[aria-hidden="true"]')
  const printState = await page.evaluate(() => {
    const frame = document.querySelector('iframe[aria-hidden="true"]')
    const doc = frame?.contentDocument
    if (!doc) return null
    const blocks = [...doc.querySelectorAll('.export-details')]
    const nextParagraphs = blocks.map((block) => block.nextElementSibling?.textContent ?? '')
    return {
      nativeDetails: doc.querySelectorAll('details').length,
      summaryCount: doc.querySelectorAll('.export-details-summary').length,
      blocks: blocks.map((block, index) => {
        const contentElement = block.querySelector('.export-details-content')
        const style = contentElement ? getComputedStyle(contentElement) : null
        return {
          summary: block.querySelector('.export-details-summary')?.textContent ?? '',
          content: contentElement?.textContent ?? '',
          display: style?.display ?? '',
          height: contentElement?.getBoundingClientRect().height ?? 0,
          nextParagraph: nextParagraphs[index],
        }
      }),
    }
  })

  assert.ok(printState, '打印文档不存在')
  assert.equal(printState.nativeDetails, 0, '打印文档仍包含原生 details')
  assert.equal(printState.summaryCount, 3, `折叠标题数量不对：${printState.summaryCount}`)
  assert.equal(printState.blocks.length, 3, `折叠块数量不对：${printState.blocks.length}`)
  for (const [index, item] of printState.blocks.entries()) {
    assert.equal(item.summary, `打印折叠标题 ${index + 1}`, `折叠标题不对：${item.summary}`)
    assert.equal(item.content, `打印折叠内容 ${index + 1}：默认应该展开显示。`, '折叠内容缺失')
    assert.notEqual(item.display, 'none', '折叠内容被隐藏')
    assert.ok(item.height > 0, `折叠内容高度异常：${item.height}`)
    assert.equal(item.nextParagraph, `打印折叠块 ${index + 1} 后面的段落。`, '折叠块后的内容顺序异常')
  }
  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  console.log(JSON.stringify({ printState, consoleErrors: errors }, null, 2))
  console.log('PDF 浏览器打印自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
