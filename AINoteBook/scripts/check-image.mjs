import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.APP_URL || 'http://localhost:5173'
const shotDir = path.resolve('.tmp-shots')
const downloadDir = path.resolve('.tmp-downloads')
fs.mkdirSync(shotDir, { recursive: true })
fs.mkdirSync(downloadDir, { recursive: true })
for (const file of fs.readdirSync(downloadDir)) fs.unlinkSync(path.join(downloadDir, file))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: path.resolve(`.tmp-chrome-image-${Date.now()}`),
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1500, height: 1000 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

const client = await page.createCDPSession()
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })

async function waitForDownload(ext, timeout = 90000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const files = fs
      .readdirSync(downloadDir)
      .filter((file) => file.endsWith(ext) && !file.endsWith('.crdownload'))
    if (files.length > 0) {
      const target = path.join(downloadDir, files[0])
      if (fs.statSync(target).size > 0) return target
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`等待 ${ext} 下载超时`)
}

async function pasteImage(color) {
  const result = await page.evaluate(async (paintColor) => {
    const createBlob = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 240
      canvas.height = 140
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建画布')
      context.fillStyle = paintColor
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#ffffff'
      context.font = '24px sans-serif'
      context.fillText(`图片 ${paintColor}`, 56, 80)
      return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    }

    if (!window.__imageTestBlob || window.__imageTestColor !== paintColor) {
      window.__imageTestBlob = await createBlob()
      window.__imageTestColor = paintColor
    }

    const file = new File([window.__imageTestBlob], `paste-${paintColor}.png`, {
      type: 'image/png',
    })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    const event = new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    })
    document.querySelector('.ProseMirror')?.dispatchEvent(event)
    return { prevented: event.defaultPrevented, files: transfer.files.length }
  }, color)

  assert.ok(result.prevented && result.files === 1, '粘贴事件没有被图片处理器接收')
}

async function clickExport(label) {
  await page.waitForFunction(() => !document.querySelector('button[title="导出"]')?.disabled)
  await page.click('button[title="导出"]')
  await page.waitForSelector('.topbar-menu')
  const buttons = await page.$$('.topbar-menu button')
  for (const button of buttons) {
    const text = await button.evaluate((el) => el.textContent ?? '')
    if (text.includes(label)) {
      await button.click()
      return
    }
  }
  throw new Error(`未找到导出项：${label}`)
}

await page.goto(URL, { waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')

// 新建测试笔记
const adds = await page.$$('.section-add')
await adds[0].click()
await page.waitForSelector('.popup-menu')
const menuButtons = await page.$$('.popup-menu button')
await menuButtons[0].click()
await page.waitForSelector('.dialog input')
await page.$eval('.dialog input', (input) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, '图片测试')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const dialogButtons = await page.$$('.dialog-actions button')
await dialogButtons[1].click()
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '图片测试')
await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)

// 同一张图粘贴两次（去重）+ 另一张图一次
await pasteImage('blue')
await page.waitForFunction(() => document.querySelectorAll('.note-image').length === 1)
await pasteImage('blue')
await page.waitForFunction(() => document.querySelectorAll('.note-image').length === 2)
await pasteImage('orange')
await page.waitForFunction(() => document.querySelectorAll('.note-image').length === 3)
await page.waitForFunction(() =>
  [...document.querySelectorAll('.note-image-img')].every((img) => img.complete),
)

// 资源表、笔记路径、去重结果
await new Promise((resolve) => setTimeout(resolve, 1200))
const assetState = await page.evaluate(async () => {
  const openDb = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  const readKey = async (key) => {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readonly')
      const request = tx.objectStore('keyval').get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  const assets = (await readKey('ainb.assets.meta')) ?? []
  const tree = (await readKey('ainb.tree.v2')) ?? []
  const note = tree.find((item) => item.name === '图片测试')
  const content = note ? await readKey(`ainb.node.${note.id}`) : undefined
  const images = []
  const visit = (nodeContent) => {
    if (!nodeContent) return
    if (nodeContent.type === 'noteImage') images.push(nodeContent.attrs)
    nodeContent.content?.forEach(visit)
  }
  visit(content)

  return {
    assets: assets.map((asset) => ({
      id: asset.id,
      hash: asset.hash,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      hasLastUsedAt: typeof asset.lastUsedAt === 'number',
    })),
    imageAttrs: images,
    imageCount: document.querySelectorAll('.note-image').length,
    storageText: document.querySelector('.storage-usage')?.textContent ?? '',
  }
})

assert.equal(assetState.assets.length, 2, '相同图片没有被哈希去重')
assert.equal(assetState.imageAttrs.length, 3, '图片节点数量不正确')
assert.equal(assetState.imageAttrs[0].assetId, assetState.imageAttrs[1].assetId, '同图应共享 assetId')
assert.notEqual(assetState.imageAttrs[0].assetId, assetState.imageAttrs[2].assetId, '不同图应不同 assetId')
for (const asset of assetState.assets) {
  assert.equal(asset.id, asset.hash)
  assert.equal(asset.width, 240)
  assert.equal(asset.height, 140)
  assert.ok(asset.hasLastUsedAt)
}
for (const image of assetState.imageAttrs) {
  assert.ok(image.path.startsWith('assets/photos/图片测试/'), '虚拟路径不正确')
  assert.ok(image.path.endsWith('.png'))
}
assert.ok(assetState.storageText.includes('本机存储'), '侧栏没有显示存储用量')

// hover 手型 -> 第一次点击放大图标 -> 第二次点击灯箱
await page.hover('.note-image-img')
const hoverCursor = await page.$eval('.note-image-img', (el) => getComputedStyle(el).cursor)
assert.equal(hoverCursor, 'pointer')

await page.click('.note-image-img')
await page.waitForSelector('.note-image.armed')
const armedState = await page.evaluate(() => ({
  cursor: getComputedStyle(document.querySelector('.note-image-img')).cursor,
  hint: Boolean(document.querySelector('.note-image-zoom-hint')),
}))
assert.equal(armedState.cursor, 'zoom-in')
assert.ok(armedState.hint)

await page.click('.note-image-img')
await page.waitForSelector('.image-lightbox')
const lightboxSrc = await page.$eval('.image-lightbox img', (el) => el.getAttribute('src'))
assert.ok(lightboxSrc?.startsWith('blob:'), '灯箱图片未加载')
await page.screenshot({ path: path.join(shotDir, 'image-lightbox.png') })
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.image-lightbox'))

// Markdown 单文件（图片内嵌 data URI）
await clickExport('单文件')
const mdPath = await waitForDownload('.md')
const markdown = fs.readFileSync(mdPath, 'utf8')
assert.ok(markdown.includes('data:image/png;base64,'), '单文件 Markdown 未内嵌图片')

// Markdown ZIP（md + assets/photos/<笔记名>/）
await clickExport('ZIP')
const zipPath = await waitForDownload('.zip')
const zip = await JSZip.loadAsync(fs.readFileSync(zipPath))
const entryNames = Object.keys(zip.files)
const mdEntry = entryNames.find((name) => name.endsWith('.md'))
assert.ok(mdEntry, 'ZIP 内没有 Markdown')
assert.ok(
  entryNames.some((name) => name.startsWith('assets/photos/图片测试/') && name.endsWith('.png')),
  'ZIP 内没有按笔记名分目录的图片',
)
const zipMarkdown = await zip.file(mdEntry).async('string')
assert.ok(zipMarkdown.includes('assets/photos/图片测试/'), 'ZIP Markdown 图片路径不正确')

// PDF 直接下载仍可生成
await clickExport('直接下载')
const pdfPath = await waitForDownload('.pdf')
const pdfBuffer = fs.readFileSync(pdfPath)
assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF')
assert.ok(pdfBuffer.length > 20000, '带图片的 PDF 文件过小')

// 删除笔记 -> 宽限期 0 的 mark-sweep 应清掉两张资源
const noteRow = await page.evaluateHandle(() => {
  return (
    [...document.querySelectorAll('.tree-row')].find(
      (el) => el.querySelector('.row-name')?.textContent === '图片测试',
    ) ?? null
  )
})
const noteElement = noteRow.asElement()
assert.ok(noteElement, '找不到测试笔记')
const moreButton = await noteElement.$('.row-action[title="更多"]')
await moreButton.click()
await page.waitForSelector('.popup-menu')
const moreButtons = await page.$$('.popup-menu button')
for (const button of moreButtons) {
  const text = await button.evaluate((el) => el.textContent ?? '')
  if (text.includes('删除')) {
    await button.click()
    break
  }
}
await page.waitForSelector('.dialog-message')
const confirmButtons = await page.$$('.dialog-actions button')
await confirmButtons[confirmButtons.length - 1].click()
await page.waitForFunction(
  () => ![...document.querySelectorAll('.row-name')].some((el) => el.textContent === '图片测试'),
)
await new Promise((resolve) => setTimeout(resolve, 1200))

// 生产预览没有 /src 模块，资源清理仅开发环境可直调
const devModulesAvailable = await page.evaluate(() =>
  Boolean(document.querySelector('script[src^="/src/"]')),
)
const sweepResult = devModulesAvailable
  ? await page.evaluate(async () => {
      const module = await import('/src/lib/imageAssets.ts')
      const result = await module.sweepUnusedAssets(0)
      const index = await module.loadAssetIndex()
      return { result, remaining: index.length }
    })
  : null
if (sweepResult !== null) {
  assert.equal(sweepResult.result.deleted, 2, 'mark-sweep 未清理未引用资源')
  assert.equal(sweepResult.remaining, 0, '资源表仍有残留')
}

await page.screenshot({ path: path.join(shotDir, 'image-done.png') })
await browser.close()

const results = {
  assetCount: assetState.assets.length,
  imageCount: assetState.imageAttrs.length,
  hoverCursor,
  armedCursor: armedState.cursor,
  markdownBytes: Buffer.byteLength(markdown),
  zipEntries: entryNames.filter((name) => name.endsWith('.png')).length,
  pdfBytes: pdfBuffer.length,
  sweep: sweepResult,
  consoleErrors: errors,
}
console.log(JSON.stringify(results, null, 2))
if (errors.length) process.exit(1)
console.log('图片功能自测全部通过')
