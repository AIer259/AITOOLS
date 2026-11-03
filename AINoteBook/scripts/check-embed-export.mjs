import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const downloadDir = path.resolve('.tmp-embed-downloads')
fs.mkdirSync(downloadDir, { recursive: true })
for (const file of fs.readdirSync(downloadDir)) fs.unlinkSync(path.join(downloadDir, file))

const pdfBuffer = fs.readFileSync(path.resolve('scripts/fixtures/sample.pdf'))
const pdfBase64 = pdfBuffer.toString('base64')
const docxBuffer = fs.readFileSync(
  path.resolve('node_modules/mammoth/test/test-data/tables.docx'),
)
const docxBase64 = docxBuffer.toString('base64')
const now = Date.now()

const tree = [
  {
    id: 'main-note',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '嵌入导出测试',
    docType: 'md',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '主笔记内容' }] }],
    },
    createdAt: now,
    updatedAt: now,
  },
]

// 构造主笔记内容：两个嵌入（Markdown / PDF）
tree[0].content.content = [
  { type: 'paragraph', content: [{ type: 'text', text: '主笔记内容' }] },
  {
    type: 'documentEmbed',
    attrs: { docId: 'embed-md', name: '方案', docType: 'md' },
  },
  { type: 'paragraph', content: [{ type: 'text', text: '主笔记后续段落' }] },
  {
    type: 'documentEmbed',
    attrs: { docId: 'embed-pdf', name: '说明书', docType: 'pdf' },
  },
  {
    type: 'documentEmbed',
    attrs: { docId: 'embed-docx', name: '表格文档', docType: 'docx' },
  },
]

tree.push(
  {
    id: 'embed-md',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '方案',
    docType: 'md',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '嵌入 Markdown 内容可见' }] }],
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
    blobId: 'pdf-embed-fixture',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'folder-attach',
    area: 'space',
    parentId: null,
    kind: 'folder',
    name: '嵌入导出测试附件',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'embed-docx',
    area: 'space',
    parentId: null,
    kind: 'doc',
    name: '表格文档',
    docType: 'docx',
    blobId: 'docx-embed-fixture',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'embed-extra',
    area: 'space',
    parentId: 'folder-attach',
    kind: 'doc',
    name: '补充说明',
    docType: 'md',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '未嵌入的附件内容' }] }],
    },
    createdAt: now,
    updatedAt: now,
  },
)

async function launch() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-embed-export-'))
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir,
    args: ['--no-first-run', '--disable-gpu'],
    defaultViewport: { width: 1500, height: 1000 },
  })
  return { browser, userDataDir }
}

async function seed(page, nodes, activeId) {
  await page.evaluate(
    async ({ nodes: treeNodes, pdf, docx, active }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('keyval-store')
        request.onupgradeneeded = () => request.result.createObjectStore('keyval')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const pdfBytes = Uint8Array.from(atob(pdf), (char) => char.charCodeAt(0))
      const docxBytes = Uint8Array.from(atob(docx), (char) => char.charCodeAt(0))
      await new Promise((resolve, reject) => {
        const tx = db.transaction('keyval', 'readwrite')
        tx.objectStore('keyval').clear()
        tx.objectStore('keyval').put(treeNodes, 'ainb.tree.v1')
        tx.objectStore('keyval').put(pdfBytes.buffer, 'ainb.blob.pdf-embed-fixture')
        tx.objectStore('keyval').put(docxBytes.buffer, 'ainb.blob.docx-embed-fixture')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      localStorage.setItem('ainb.active.v1', active)
    },
    { nodes, pdf: pdfBase64, docx: docxBase64, active: activeId },
  )
}

async function attachmentFolderState(page) {
  return page.evaluate(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(
      (item) => item.querySelector('.row-name')?.textContent === '嵌入导出测试附件',
    )
    return {
      expanded: row?.querySelector('.chevron-btn')?.getAttribute('aria-expanded') ?? null,
      names: [...document.querySelectorAll('.row-name')].map(
        (item) => item.textContent?.trim() ?? '',
      ),
    }
  })
}

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

let exportedZipPath = ''

// 第一台“电脑”：导出
{
  const { browser, userDataDir } = await launch()
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  const client = await page.createCDPSession()
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })

  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.paper')
    await seed(page, tree, 'main-note')
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForFunction(
      () => document.querySelector('.note-title')?.value === '嵌入导出测试',
    )

    // 打开主笔记后，平级嵌入文档应被移入附件文件夹
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.row-name')].some(
          (item) => item.textContent === '嵌入导出测试附件',
        ),
      { timeout: 10000 },
    )
    const exportFolderState = await attachmentFolderState(page)
    assert.equal(exportFolderState.expanded, 'false', '附件文件夹应默认折叠')
    assert.ok(!exportFolderState.names.includes('方案'), '折叠时不应显示附件文档')

    await page.click('button[title="导出"]')
    await page.waitForSelector('.topbar-menu')
    for (const item of await page.$$('.topbar-menu button')) {
      const label = await item.evaluate((element) => element.textContent ?? '')
      if (label.includes('ZIP')) {
        await item.click()
        break
      }
    }

    exportedZipPath = await waitForDownload('.zip')
    assert.deepEqual(errors, [], `导出控制台错误：${errors.join(' | ')}`)
  } finally {
    await browser.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

const zip = await JSZip.loadAsync(fs.readFileSync(exportedZipPath))
const entries = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
assert.ok(entries.includes('嵌入导出测试.md'), `缺少主文件：${entries.join(', ')}`)
assert.ok(
  entries.includes('嵌入导出测试附件/方案.md'),
  `缺少 Markdown 附件：${entries.join(', ')}`,
)
assert.ok(
  entries.includes('嵌入导出测试附件/说明书.pdf'),
  `缺少 PDF 附件：${entries.join(', ')}`,
)
assert.ok(
  entries.includes('嵌入导出测试附件/补充说明.md'),
  `缺少未嵌入的附件文件：${entries.join(', ')}`,
)
assert.ok(
  entries.includes('嵌入导出测试附件/表格文档.docx'),
  `缺少 Word 附件：${entries.join(', ')}`,
)

const mainMarkdown = await zip.file('嵌入导出测试.md').async('string')
assert.ok(mainMarkdown.includes('data-doc-embed="嵌入导出测试附件/方案.md"'), '主文件缺少 Markdown 嵌入标记')
assert.ok(mainMarkdown.includes('data-doc-embed="嵌入导出测试附件/说明书.pdf"'), '主文件缺少 PDF 嵌入标记')
const attachmentMarkdown = await zip.file('嵌入导出测试附件/方案.md').async('string')
assert.ok(attachmentMarkdown.includes('嵌入 Markdown 内容可见'), '附件 Markdown 内容缺失')

// 第二台“电脑”：导入
{
  const { browser, userDataDir } = await launch()
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.paper')

    const zipInput = await page.$('input[accept*=".zip"]')
    assert.ok(zipInput, '未找到 ZIP 导入输入框')
    await zipInput.uploadFile(exportedZipPath)
    await page.waitForFunction(
      () => document.querySelector('.note-title')?.value === '嵌入导出测试',
      { timeout: 30000 },
    )

    await page.waitForFunction(() => document.querySelectorAll('.embed-node').length === 3)
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.row-name')].some(
          (item) => item.textContent === '嵌入导出测试附件',
        ),
    )
    const importFolderState = await attachmentFolderState(page)
    assert.equal(importFolderState.expanded, 'false', '导入的附件文件夹应默认折叠')
    assert.ok(!importFolderState.names.includes('补充说明'), '折叠时不应显示附件文档')

    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tree-row')].find(
        (item) => item.querySelector('.row-name')?.textContent === '嵌入导出测试附件',
      )
      row?.querySelector('.chevron-btn')?.click()
    })
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.row-name')].some(
          (item) => item.textContent === '补充说明',
        ),
    )

    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.embed-node')].find(
        (item) => item.querySelector('.embed-name')?.textContent === '方案',
      )
      card?.querySelector('.embed-main')?.click()
    })
    await page.waitForFunction(
      () => document.querySelector('.embed-node .embed-md')?.textContent?.includes('嵌入 Markdown 内容可见'),
      { timeout: 20000 },
    )

    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.embed-node')].find(
        (item) => item.querySelector('.embed-name')?.textContent === '说明书',
      )
      card?.querySelector('.embed-main')?.click()
    })
    await page.waitForSelector('.embed-node iframe.embed-pdf', { timeout: 20000 })
    const pdfSrc = await page.$eval('.embed-node iframe.embed-pdf', (element) =>
      element.getAttribute('src'),
    )
    assert.ok(pdfSrc?.startsWith('blob:'), '导入后的 PDF 嵌入未加载')

    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.embed-node')].find(
        (item) => item.querySelector('.embed-name')?.textContent === '表格文档',
      )
      card?.querySelector('.embed-main')?.click()
    })
    await page.waitForSelector('.embed-node .embed-docx table', { timeout: 20000 })

    // 删除主笔记时，附件文件夹与其中的文档应一起删除
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tree-row')].find(
        (item) => item.querySelector('.row-name')?.textContent === '嵌入导出测试',
      )
      row?.querySelector('.row-action[title="更多"]')?.click()
    })
    await page.waitForSelector('.popup-menu')
    for (const button of await page.$$('.popup-menu button')) {
      const label = await button.evaluate((element) => element.textContent ?? '')
      if (label.includes('删除')) {
        await button.click()
        break
      }
    }
    await page.waitForSelector('.dialog-message')
    const deleteMessage = await page.$eval('.dialog-message', (element) =>
      element.textContent ?? '',
    )
    assert.ok(deleteMessage.includes('附件文件夹'), `删除提示未说明附件：${deleteMessage}`)
    const confirmButtons = await page.$$('.dialog-actions button')
    await confirmButtons[confirmButtons.length - 1].click()
    await page.waitForFunction(() => {
      const names = [...document.querySelectorAll('.row-name')].map(
        (item) => item.textContent?.trim() ?? '',
      )
      return !['嵌入导出测试', '嵌入导出测试附件', '方案', '说明书', '表格文档', '补充说明'].some(
        (name) => names.includes(name),
      )
    })

    assert.deepEqual(errors, [], `导入控制台错误：${errors.join(' | ')}`)
  } finally {
    await browser.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

console.log(
  JSON.stringify(
    {
      zipEntries: entries,
      mainMarkdownBytes: Buffer.byteLength(mainMarkdown),
      imported: true,
      consoleErrors: [],
    },
    null,
    2,
  ),
)
console.log('嵌入文档导出与跨设备导入自测全部通过')
