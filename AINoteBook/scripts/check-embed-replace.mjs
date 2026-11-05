import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5174'
const pdfA = fs.readFileSync(path.resolve('scripts/fixtures/sample.pdf'))
const pdfB = makeReplacePdf('Replace OK 999')
const pdfA64 = pdfA.toString('base64')
const pdfB64 = pdfB.toString('base64')
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-chrome-embed-replace-'))
const pdfBDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-embed-replace-'))
const pdfBPath = path.join(pdfBDir, 'replace.pdf')
fs.writeFileSync(pdfBPath, pdfB)

// 生成一个内容与 sample.pdf 不同、但结构合法的最小单页 PDF
function makeReplacePdf(text) {
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefOffset = pdf.length
  const size = objects.length + 1
  pdf += `xref\n0 ${size}\n`
  pdf += '0000000000 65535 f \n'
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'ascii')
}

const now = Date.now()
const tree = [
  {
    id: 'main-note',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '嵌入替换测试',
    docType: 'md',
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '主笔记内容' }] },
        { type: 'documentEmbed', attrs: { docId: 'embed-pdf', name: '说明书', docType: 'pdf' } },
      ],
    },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'embed-pdf',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '说明书',
    docType: 'pdf',
    blobId: 'pdf-replace-fixture',
    createdAt: now,
    updatedAt: now,
  },
]

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

async function seed() {
  await page.evaluate(
    async ({ treeNodes, pdf, active }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('keyval-store')
        request.onupgradeneeded = () => request.result.createObjectStore('keyval')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const pdfBytes = Uint8Array.from(atob(pdf), (char) => char.charCodeAt(0))
      await new Promise((resolve, reject) => {
        const tx = db.transaction('keyval', 'readwrite')
        tx.objectStore('keyval').clear()
        tx.objectStore('keyval').put(treeNodes, 'ainb.tree.v1')
        tx.objectStore('keyval').put(pdfBytes.buffer, 'ainb.blob.pdf-replace-fixture')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      localStorage.setItem('ainb.active.v1', active)
    },
    { treeNodes: tree, pdf: pdfA64, active: 'main-note' },
  )
}

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.paper')
  await seed()
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '嵌入替换测试',
    { timeout: 20000 },
  )
  await page.waitForFunction(() => document.querySelectorAll('.embed-node').length === 1, {
    timeout: 20000,
  })

  // PDF 嵌入卡片头部有「替换附件」按钮
  assert.ok(await page.$('.embed-node .embed-replace'), 'PDF 嵌入卡片缺少替换按钮')

  // 展开 PDF，记录原始 iframe 地址
  await page.click('.embed-node .embed-main')
  await page.waitForSelector('.embed-node iframe.embed-pdf', { timeout: 20000 })
  const srcA = await page.$eval('.embed-node iframe.embed-pdf', (el) => el.getAttribute('src'))
  assert.ok(srcA?.startsWith('blob:'), 'PDF 嵌入未加载')

  // 全屏下应有保存提示与替换按钮
  await page.click('.embed-node .embed-zoom')
  await page.waitForSelector('.embed-fullscreen', { timeout: 10000 })
  assert.ok(await page.$('.embed-fullscreen-replace'), '全屏缺少「替换附件」按钮')
  assert.ok(await page.$('.embed-fullscreen-hint'), '全屏缺少保存提示')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.embed-fullscreen'), { timeout: 5000 })

  // 替换：上传新 PDF 覆盖原附件
  const replaceInput = await page.$('.embed-node input[type="file"]')
  assert.ok(replaceInput, '缺少替换文件输入框')
  await replaceInput.uploadFile(pdfBPath)
  await page.waitForFunction(
    () => document.querySelector('.toast')?.textContent?.includes('附件已替换'),
    { timeout: 15000 },
  )
  await page.waitForFunction(
    (oldSrc) => {
      const el = document.querySelector('.embed-node iframe.embed-pdf')
      return el && el.getAttribute('src') !== oldSrc
    },
    { timeout: 15000 },
    srcA,
  )

  // 验证 IndexedDB 里的 blob 已覆盖为新 PDF 内容
  const storedBase64 = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readonly')
      const req = tx.objectStore('keyval').get('ainb.blob.pdf-replace-fixture')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const bytes = new Uint8Array(value)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  })
  assert.equal(storedBase64, pdfB64, '替换后 blob 未写入新 PDF 内容')

  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  console.log(
    JSON.stringify(
      {
        replaceButton: true,
        fullscreenHint: true,
        fullscreenReplace: true,
        iframeRefreshed: true,
        blobOverwritten: true,
        blobBytes: Buffer.byteLength(pdfB),
        consoleErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log('嵌入 PDF 替换附件自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
  fs.rmSync(pdfBDir, { recursive: true, force: true })
}
