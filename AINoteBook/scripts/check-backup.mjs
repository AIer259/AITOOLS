import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import JSZip from 'jszip'

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CDP_PORT || 9338)
const URL = process.env.APP_URL || 'http://localhost:5174'
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-backup-profile-'))
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-backup-downloads-'))

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

process.on('exit', () => {
  try {
    chrome.kill()
  } catch {
    // 已退出
  }
  for (const dir of [profile, downloadDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 临时目录稍后清理
    }
  }
})

let wsUrl = null
for (let i = 0; i < 60; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    const targets = await res.json()
    const page = targets.find((target) => target.type === 'page')
    if (page) {
      wsUrl = page.webSocketDebuggerUrl
      break
    }
  } catch {
    // Chrome 尚未就绪
  }
  await sleep(200)
}
assert.ok(wsUrl, '无法连接 Chrome 调试端口')

const ws = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let seq = 0
let loadEvents = 0
const pending = new Map()
const consoleErrors = []
const watchdog = setTimeout(() => {
  console.error('自测超时，强制退出')
  console.error('consoleErrors:', consoleErrors)
  process.exit(2)
}, 90000)

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id) {
    const callback = pending.get(message.id)
    if (!callback) return
    pending.delete(message.id)
    if (message.error) callback.reject(new Error(message.error.message))
    else callback.resolve(message.result)
    return
  }

  if (message.method === 'Page.loadEventFired') loadEvents += 1
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(
      message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '),
    )
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params.exceptionDetails.text)
  }
}

function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

async function waitFor(expression, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return
    } catch {
      // 导航中
    }
    await sleep(100)
  }
  throw new Error(`等待超时: ${expression}`)
}

async function reloadPage() {
  const before = loadEvents
  await send('Page.reload', { ignoreCache: true })
  const deadline = Date.now() + 15000
  while (loadEvents <= before && Date.now() < deadline) await sleep(50)
  assert.ok(loadEvents > before, '页面刷新未完成')
}

async function clickByText(selector, text) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(
      (item) => item.textContent?.includes(${JSON.stringify(text)}),
    )
    button?.click()
  })()`)
}

async function clickPrimaryBackup() {
  const point = await evaluate(`(() => {
    const button = document.querySelector('.backup-banner .btn.primary')
    if (!button) throw new Error('找不到备份按钮')
    const rect = button.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })()`)

  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
    })
  }
}

async function waitForZip(timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const file = fs
      .readdirSync(downloadDir)
      .find((name) => name.endsWith('.zip'))
    if (file) {
      const full = path.join(downloadDir, file)
      if (fs.statSync(full).size > 0) return full
    }
    await sleep(150)
  }
  throw new Error('等待备份 ZIP 下载超时')
}

async function readKey(key) {
  return evaluate(`new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('keyval', 'readonly')
      const get = tx.objectStore('keyval').get(${JSON.stringify(key)})
      get.onsuccess = () => resolve(get.result ?? null)
      get.onerror = () => reject(get.error)
    }
    req.onerror = () => reject(req.error)
  })`)
}

const now = Date.now()
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
const tree = [
  {
    id: 'folder-notes',
    area: 'space',
    parentId: null,
    kind: 'folder',
    name: '资料',
    order: 'a1',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-main',
    area: 'space',
    parentId: 'folder-notes',
    kind: 'doc',
    name: '主文档',
    order: 'a2',
    docType: 'md',
    attachmentFolderId: 'folder-attach',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'folder-attach',
    area: 'space',
    parentId: 'folder-notes',
    kind: 'folder',
    name: '主文档附件',
    order: 'a3',
    ownerDocId: 'doc-main',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-embed',
    area: 'space',
    parentId: 'folder-attach',
    kind: 'doc',
    name: '嵌入文档',
    order: 'a1',
    docType: 'md',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-pdf',
    area: 'space',
    parentId: 'folder-attach',
    kind: 'doc',
    name: '说明',
    order: 'a2',
    docType: 'pdf',
    blobId: 'blob-pdf',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-private',
    area: 'private',
    parentId: null,
    kind: 'doc',
    name: '私人笔记',
    order: 'a1',
    docType: 'md',
    createdAt: now,
    updatedAt: now,
  },
]
const mainContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '备份正文' }] },
    { type: 'noteImage', attrs: { assetId: 'asset-1', alt: '测试图', path: '' } },
    {
      type: 'documentEmbed',
      attrs: { docId: 'doc-embed', name: '嵌入文档', docType: 'md' },
    },
  ],
}
const embedContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '嵌入正文' }] },
    { type: 'noteImage', attrs: { assetId: 'asset-1', alt: '测试图', path: '' } },
  ],
}
const privateContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '私人正文' }] },
    { type: 'noteImage', attrs: { assetId: 'asset-1', alt: '测试图', path: '' } },
  ],
}
const assetMeta = [
  {
    id: 'asset-1',
    hash: 'hash-1',
    mime: 'image/png',
    width: 1,
    height: 1,
    createdAt: now,
    lastUsedAt: now,
  },
]

await send('Page.enable')
await send('Runtime.enable')
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__idbReads = []
    const originalGet = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key) {
      try { window.__idbReads.push(String(key)) } catch (error) {}
      return originalGet.apply(this, arguments)
    }`,
})
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
try {
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
    eventsEnabled: true,
  })
} catch {
  await send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
  })
}

await send('Page.navigate', { url: URL })
await waitFor(`Boolean(document.querySelector('.sidebar') && !document.querySelector('.loading-screen'))`)

await evaluate(`new Promise((resolve, reject) => {
  const req = indexedDB.open('keyval-store')
  req.onupgradeneeded = () => req.result.createObjectStore('keyval')
  req.onsuccess = () => {
    const db = req.result
    const tx = db.transaction('keyval', 'readwrite')
    const store = tx.objectStore('keyval')
    store.clear()
    store.put(${JSON.stringify(tree)}, 'ainb.tree.v2')
    store.put(${JSON.stringify(mainContent)}, 'ainb.node.doc-main')
    store.put(${JSON.stringify(embedContent)}, 'ainb.node.doc-embed')
    store.put(${JSON.stringify(privateContent)}, 'ainb.node.doc-private')
    store.put(${JSON.stringify(assetMeta)}, 'ainb.assets.meta')
    const png = Uint8Array.from(atob(${JSON.stringify(pngBase64)}), (char) => char.charCodeAt(0))
    store.put(new Blob([png], { type: 'image/png' }), 'ainb.asset.asset-1')
    const pdf = new TextEncoder().encode('%PDF-1.4\\n% backup test\\n%%EOF\\n')
    store.put(pdf.buffer, 'ainb.blob.blob-pdf')
    tx.oncomplete = () => {
      localStorage.removeItem('ainb.backup.v1')
      localStorage.removeItem('ainb.active.v1')
      resolve(true)
    }
    tx.onerror = () => reject(tx.error)
  }
  req.onerror = () => reject(req.error)
})`)

await reloadPage()
await waitFor(`Boolean(document.querySelector('.sidebar')) && !document.querySelector('.loading-screen')`)
await waitFor(`Boolean(document.querySelector('.backup-banner'))`)

assert.ok(
  await evaluate(`Boolean(document.querySelector('.backup-menu-button'))`),
  '顶栏缺少备份菜单',
)
assert.equal(
  await evaluate(`Boolean(document.querySelector('.sidebar-backup'))`),
  false,
  '侧栏不应再有备份入口',
)

await evaluate(`document.querySelector('.backup-menu-button').click()`)
await waitFor(`Boolean(document.querySelector('.popup-menu'))`)
const backupMenuLabels = await evaluate(
  `[...document.querySelectorAll('.popup-menu button')].map((item) => item.textContent?.trim() ?? '')`,
)
assert.ok(
  backupMenuLabels.some((label) => label.includes('导出全部笔记')),
  `备份菜单缺少导出：${backupMenuLabels.join(' / ')}`,
)
assert.ok(
  backupMenuLabels.some((label) => label.includes('从备份恢复')),
  `备份菜单缺少恢复：${backupMenuLabels.join(' / ')}`,
)
await evaluate(
  `document.querySelector('.menu-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
)
await waitFor(`!document.querySelector('.popup-menu')`)

const devModules = await evaluate(
  `Boolean(document.querySelector('script[src^="/src/"]'))`,
)
if (devModules) {
  const logic = await evaluate(`(async () => {
    const module = await import('/src/lib/backup.ts')
    const now = Date.now()
    const base = {
      lastBackupAt: now,
      lastBackupDocCount: 10,
      ignored: false,
      snoozedUntil: null,
    }
    return {
      diff10: module.getBackupReminder(base, 20, now),
      diff9: module.getBackupReminder(base, 19, now),
      stale: module.getBackupReminder(
        { ...base, lastBackupAt: now - module.BACKUP_STALE_MS },
        20,
        now,
      ),
      ignored: module.getBackupReminder({ ...base, ignored: true }, 20, now),
      snoozed: module.getBackupReminder(
        { ...base, snoozedUntil: now + 1000 },
        20,
        now,
      ),
    }
  })()`)
  assert.deepEqual(logic, {
    diff10: 'changes',
    diff9: null,
    stale: 'stale',
    ignored: null,
    snoozed: null,
  })
}

await clickByText('.backup-banner button', '7 天后再提醒')
await waitFor(`!document.querySelector('.backup-banner')`)
const snoozedRecord = await evaluate(
  `JSON.parse(localStorage.getItem('ainb.backup.v1') ?? '{}')`,
)
assert.ok(
  snoozedRecord.snoozedUntil > Date.now() + 6 * 24 * 60 * 60 * 1000,
  'snooze 未写入 7 天',
)

await reloadPage()
await waitFor(`Boolean(document.querySelector('.sidebar')) && !document.querySelector('.loading-screen')`)
await sleep(400)
assert.equal(
  await evaluate(`Boolean(document.querySelector('.backup-banner'))`),
  false,
  'snooze 后刷新仍显示提醒',
)

await evaluate(`localStorage.removeItem('ainb.backup.v1')`)
await reloadPage()
await waitFor(`Boolean(document.querySelector('.backup-banner'))`)

// 等编辑器图片加载完，避免把 UI 读取资源索引计入导出
await waitFor(
  `Boolean(document.querySelector('.note-image-img'))
    && [...document.querySelectorAll('.note-image-img')].every((img) => img.complete)`,
)
await evaluate(`window.__idbReads = []`)
await clickPrimaryBackup()
const zipPath = await waitForZip()
const exportReads = await evaluate(`window.__idbReads`)
await waitFor(`!document.querySelector('.backup-banner')`)
const backupRecord = await evaluate(
  `JSON.parse(localStorage.getItem('ainb.backup.v1') ?? '{}')`,
)
assert.equal(backupRecord.lastBackupDocCount, 4)
assert.equal(backupRecord.snoozedUntil, null)
assert.ok(backupRecord.lastBackupAt > 0)

const zip = await JSZip.loadAsync(fs.readFileSync(zipPath))
const names = Object.keys(zip.files)
for (const entry of [
  'manifest.json',
  'notes/空间/资料/主文档.md',
  'notes/空间/资料/主文档附件/嵌入文档.md',
  'notes/空间/资料/主文档附件/说明.pdf',
  'notes/私人/私人笔记.md',
  'contents/doc-main.json',
  'contents/doc-embed.json',
  'assets/asset-1.png',
]) {
  assert.ok(names.includes(entry), `ZIP 缺少 ${entry}`)
}

const countReads = (key) => exportReads.filter((item) => item === key).length
assert.equal(
  countReads('ainb.assets.meta'),
  1,
  `导出应只读一次资源索引：${countReads('ainb.assets.meta')}`,
)
assert.equal(
  countReads('ainb.asset.asset-1'),
  1,
  `同一图片应只读一次 Blob：${countReads('ainb.asset.asset-1')}`,
)

const compressionOf = (name) => {
  const magic = zip.files[name]?._data?.compression?.magic
  if (magic === '\x00\x00') return 'STORE'
  if (magic === '\x08\x00') return 'DEFLATE'
  return 'UNKNOWN'
}
assert.equal(compressionOf('assets/asset-1.png'), 'STORE', '图片应使用 STORE 压缩')
assert.equal(compressionOf('notes/空间/资料/主文档附件/说明.pdf'), 'STORE', 'PDF 应使用 STORE 压缩')
assert.equal(compressionOf('notes/空间/资料/主文档.md'), 'DEFLATE', 'Markdown 应使用 DEFLATE')
assert.equal(compressionOf('manifest.json'), 'DEFLATE', 'manifest 应使用 DEFLATE')

const manifest = JSON.parse(await zip.file('manifest.json').async('string'))
assert.equal(manifest.format, 'ainoteBook-backup')
assert.equal(manifest.formatVersion, 1)
assert.equal(manifest.trashIncluded, false)
assert.equal(manifest.counts.docs, 4)
assert.equal(manifest.counts.folders, 2)
assert.equal(manifest.counts.images, 1)
assert.equal(manifest.counts.files, 1)
assert.equal(manifest.assets[0].id, 'asset-1')
assert.equal(manifest.assets[0].path, 'assets/asset-1.png')
assert.equal(manifest.nodes.length, 6)

const mainMarkdown = await zip.file('notes/空间/资料/主文档.md').async('string')
assert.ok(mainMarkdown.includes('备份正文'), 'Markdown 缺少正文')
assert.ok(
  mainMarkdown.includes('../../../assets/asset-1.png'),
  `Markdown 图片路径不正确：${mainMarkdown}`,
)
assert.ok(
  mainMarkdown.includes('data-doc-embed="主文档附件/嵌入文档.md"'),
  `Markdown 嵌入路径不正确：${mainMarkdown}`,
)

const contentJson = JSON.parse(
  await zip.file('contents/doc-main.json').async('string'),
)
assert.ok(
  contentJson.content.some((node) => node.type === 'noteImage'),
  '原始 JSON 缺少图片节点',
)
const pdfBytes = await zip.file('notes/空间/资料/主文档附件/说明.pdf').async('uint8array')
assert.equal(Buffer.from(pdfBytes.subarray(0, 4)).toString(), '%PDF')

// 从备份 ZIP 合并恢复：原笔记保留，备份内容进入新文件夹
const document = await send('DOM.getDocument', { depth: -1 })
const input = await send('DOM.querySelector', {
  nodeId: document.root.nodeId,
  selector: '.backup-restore-input',
})
assert.ok(input.nodeId, '找不到恢复文件输入框')
await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [zipPath] })
await waitFor(`Boolean(document.querySelector('.dialog-message'))`)
const restoreDialog = await evaluate(
  `document.querySelector('.dialog-message')?.textContent ?? ''`,
)
assert.ok(restoreDialog.includes('4 篇文档'), `恢复摘要不正确：${restoreDialog}`)
assert.ok(restoreDialog.includes('现有笔记不受影响'), '恢复摘要缺少合并说明')
await clickByText('.dialog-actions button', '合并恢复')
await waitFor(`!document.querySelector('.dialog-backdrop')`)
await waitFor(
  `[...document.querySelectorAll('.row-name')].some((item) => item.textContent?.startsWith('备份恢复 '))`,
)

const restoredTree = await readKey('ainb.tree.v2')
assert.equal(restoredTree.length, 14, '合并后节点数量不正确')
assert.equal(
  restoredTree.filter((node) => node.name === '主文档').length,
  2,
  '合并后应保留原文档并增加恢复文档',
)
assert.equal(
  restoredTree.filter((node) => node.name.startsWith('备份恢复 ')).length,
  2,
  '空间/私人应各有一个恢复文件夹',
)
const restoredMain = restoredTree.find(
  (node) => node.name === '主文档' && node.id !== 'doc-main',
)
assert.ok(restoredMain, '找不到恢复后的主文档')
const restoredContent = await readKey(`ainb.node.${restoredMain.id}`)
const restoredEmbedNode = restoredTree.find(
  (node) => node.name === '嵌入文档' && node.id !== 'doc-embed',
)
assert.ok(restoredEmbedNode, '找不到恢复后的嵌入文档')
const restoredEmbed = restoredContent.content.find(
  (node) => node.type === 'documentEmbed',
)
assert.equal(
  restoredEmbed.attrs.docId,
  restoredEmbedNode.id,
  '嵌入文档 ID 未重映射',
)
assert.equal(
  await evaluate(`JSON.parse(localStorage.getItem('ainb.backup.v1') ?? '{}').lastBackupDocCount`),
  4,
  '恢复不应改变备份记录',
)

await evaluate(`localStorage.removeItem('ainb.backup.v1')`)
await reloadPage()
await waitFor(`Boolean(document.querySelector('.backup-banner'))`)
await evaluate(`document.querySelector('.backup-ignore').click()`)
await waitFor(`!document.querySelector('.backup-banner')`)
const ignoredRecord = await evaluate(
  `JSON.parse(localStorage.getItem('ainb.backup.v1') ?? '{}')`,
)
assert.equal(ignoredRecord.ignored, true)

await reloadPage()
await waitFor(`Boolean(document.querySelector('.sidebar')) && !document.querySelector('.loading-screen')`)
await sleep(400)
assert.equal(
  await evaluate(`Boolean(document.querySelector('.backup-banner'))`),
  false,
  '忽略后刷新仍显示提醒',
)

assert.deepEqual(consoleErrors, [])
console.log('备份提醒与全量 ZIP 自测通过')
clearTimeout(watchdog)
ws.close()
chrome.kill()
await sleep(300)
process.exit(0)
