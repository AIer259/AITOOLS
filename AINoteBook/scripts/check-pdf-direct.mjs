import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const shotDir = path.resolve('.tmp-shots')
const downloadDir = path.resolve('.tmp-pdf-check-downloads')
fs.mkdirSync(shotDir, { recursive: true })
fs.mkdirSync(downloadDir, { recursive: true })
for (const file of fs.readdirSync(downloadDir)) fs.unlinkSync(path.join(downloadDir, file))
for (const file of fs.readdirSync(shotDir).filter((name) => name.startsWith('pdf-direct-'))) {
  fs.unlinkSync(path.join(shotDir, file))
}

const text = (value) => ({ type: 'text', text: value })
const paragraph = (value) => ({ type: 'paragraph', content: [text(value)] })
const callout = (value) => ({
  type: 'callout',
  content: [paragraph(value), paragraph('着重块第二行。')],
})
const details = (index) => ({
  type: 'details',
  attrs: { open: false },
  content: [
    { type: 'detailsSummary', content: [text(`折叠标题 ${index}`)] },
    {
      type: 'detailsContent',
      content: [
        paragraph(`折叠内容第一行（块 ${index}）。`),
        ...Array.from({ length: 6 }, (_, row) =>
          row === 2
            ? callout(`折叠块 ${index} 里的着重块：不应重叠。`)
            : paragraph(`折叠内容第 ${row + 1} 行（块 ${index}）：检查连续折叠块的排版。`),
        ),
        paragraph('折叠内容最后一行。'),
      ],
    },
  ],
})

const content = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('PDF 直接下载测试')] },
    ...Array.from({ length: 20 }, (_, index) =>
      paragraph(`第 ${index + 1} 段：用于检查 PDF 分页是否会把一行文字从中间切断。`),
    ),
    ...Array.from({ length: 3 }, (_, index) => [
      details(index + 1),
      paragraph(`折叠块 ${index + 1} 后面的段落：不应重叠。`),
    ]).flat(),
    ...Array.from({ length: 30 }, (_, index) =>
      paragraph(`后续第 ${index + 1} 段：继续填充内容以产生多页 PDF。`),
    ),
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: ['表头一', '表头二'].map((value) => ({
            type: 'tableHeader',
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [paragraph(value)],
          })),
        },
        ...Array.from({ length: 10 }, (_, row) => ({
          type: 'tableRow',
          content: [1, 2].map((column) => ({
            type: 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [paragraph(`第 ${row + 1} 行第 ${column} 列内容`)],
          })),
        })),
      ],
    },
    paragraph('表格后面的段落。'),
  ],
}

const tree = [
  {
    id: 'pdf-direct-note',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: 'PDF直接下载测试',
    docType: 'md',
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-pdf-check-'))
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
const client = await page.createCDPSession()
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })

async function waitForDownload(extension, timeout = 90000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const files = fs.readdirSync(downloadDir).filter((file) => file.endsWith(extension))
    if (files.length > 0) {
      const target = path.join(downloadDir, files[0])
      if (fs.statSync(target).size > 0) return target
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`没有收到 ${extension} 文件`)
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
    localStorage.setItem('ainb.active.v1', 'pdf-direct-note')
  }, tree)

  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('.note-title')?.value === 'PDF直接下载测试')

  await page.click('button[title="导出"]')
  await page.waitForSelector('.topbar-menu')
  const items = await page.$$('.topbar-menu button')
  for (const item of items) {
    const label = await item.evaluate((element) => element.textContent ?? '')
    if (label.includes('直接下载')) {
      await item.click()
      break
    }
  }

  await page.waitForSelector('.export-page')
  const exportState = await page.evaluate(() => {
    const exportPage = document.querySelector('.export-page')
    const blocks = [...exportPage.querySelectorAll('.export-details')]
    return {
      nativeDetails: exportPage.querySelectorAll('details').length,
      blocks: blocks.length,
      details: blocks.map((block) => {
        const content = block.querySelector('.export-details-content')
        const next = block.nextElementSibling
        const rect = block.getBoundingClientRect()
        const nextRect = next?.getBoundingClientRect()
        return {
          summary: block.querySelector('.export-details-summary')?.textContent ?? '',
          contentHeight: content?.getBoundingClientRect().height ?? 0,
          noOverlap: nextRect ? nextRect.top >= rect.bottom - 1 : true,
        }
      }),
      calloutPosition: getComputedStyle(exportPage.querySelector('[data-callout]')).position,
    }
  })

  assert.equal(exportState.nativeDetails, 0, '导出页仍包含原生 details')
  assert.equal(exportState.blocks, 3, `折叠块数量不对：${exportState.blocks}`)
  assert.equal(exportState.calloutPosition, 'relative', '着重块未使用静态定位')
  for (const item of exportState.details) {
    assert.ok(item.summary.includes('折叠标题'), `折叠标题缺失：${item.summary}`)
    assert.ok(item.contentHeight > 20, `折叠内容高度异常：${item.contentHeight}`)
    assert.ok(item.noOverlap, '折叠块与后续段落重叠')
  }

  const pdfFile = await waitForDownload('.pdf')
  const pdf = fs.readFileSync(pdfFile)
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF', 'PDF 文件头不正确')

  const pages = []
  for (let cursor = 0; cursor < pdf.length - 1; cursor += 1) {
    if (pdf[cursor] === 0xff && pdf[cursor + 1] === 0xd8 && pdf[cursor + 2] === 0xff) {
      let end = cursor + 2
      while (end < pdf.length - 1 && !(pdf[end] === 0xff && pdf[end + 1] === 0xd9)) end += 1
      if (end < pdf.length - 1) {
        const jpeg = pdf.subarray(cursor, end + 2)
        if (jpeg.length > 5000) pages.push(jpeg)
        cursor = end + 1
      }
    }
  }
  assert.ok(pages.length >= 2, `PDF 页数过少：${pages.length}`)

  const edgeRatios = []
  for (let index = 0; index < pages.length; index += 1) {
    const file = path.join(shotDir, `pdf-direct-page-${index + 1}.jpg`)
    fs.writeFileSync(file, pages[index])
    const dataUrl = `data:image/jpeg;base64,${pages[index].toString('base64')}`
    const ratio = await page.evaluate(async (source) => {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const rows = [0, 1, canvas.height - 2, canvas.height - 1]
      const values = rows.map((y) => {
        const data = context.getImageData(0, y, canvas.width, 1).data
        let nonWhite = 0
        for (let offset = 0; offset < data.length; offset += 4) {
          if (data[offset] < 245 || data[offset + 1] < 245 || data[offset + 2] < 245) nonWhite += 1
        }
        return nonWhite / canvas.width
      })
      return Math.max(...values)
    }, dataUrl)
    edgeRatios.push(Number(ratio.toFixed(4)))
    assert.ok(ratio < 0.03, `第 ${index + 1} 页边缘仍有内容：${ratio}`)
  }

  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  console.log(
    JSON.stringify(
      {
        exportState,
        pdfBytes: pdf.length,
        pages: pages.length,
        edgeRatios,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log('PDF 直接下载自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
