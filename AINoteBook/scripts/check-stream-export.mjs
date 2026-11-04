import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import JSZip from 'jszip'

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CDP_PORT || 9340)
const URL = process.env.APP_URL || 'http://localhost:5174'
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-stream-profile-'))
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-stream-downloads-'))

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

async function waitFor(expression, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return
    } catch {
      // 页面跳转/执行上下文变化时继续轮询
    }
    await sleep(100)
  }
  throw new Error(`等待超时：${expression}`)
}

async function readTree() {
  return evaluate(`new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('keyval', 'readonly')
      const get = tx.objectStore('keyval').get('ainb.tree.v2')
      get.onsuccess = () => resolve(get.result ?? [])
      get.onerror = () => reject(get.error)
    }
    req.onerror = () => reject(req.error)
  })`)
}

async function waitForTree(predicate, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const tree = await readTree()
    if (predicate(tree)) return tree
    await sleep(200)
  }
  throw new Error('等待文件树更新超时')
}

const countDocs = (tree) =>
  tree.filter((node) => node.kind === 'doc' && !node.deletedAt).length

async function openBackupMenu() {
  await waitFor(`document.querySelector('.backup-menu-button')?.disabled === false`)
  await evaluate(`document.querySelector('.backup-menu-button').click()`)
  await waitFor(`Boolean(document.querySelector('.popup-menu'))`)
  return evaluate(
    `[...document.querySelectorAll('.popup-menu button')].map((item) => item.textContent?.trim() ?? '')`,
  )
}

async function clickMenuItem(label) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.popup-menu button')].find(
      (item) => item.textContent?.includes(${JSON.stringify(label)}),
    )
    button?.click()
  })()`)
}

async function stubFilePicker() {
  await evaluate(`(() => {
    window.__streamChunks = []
    window.__streamClosed = false
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      writable: true,
      value: async () => ({
        createWritable: async () => ({
          write: async (chunk) => { window.__streamChunks.push(chunk) },
          close: async () => { window.__streamClosed = true },
          abort: async () => { window.__streamAborted = true },
        }),
      }),
    })
  })()`)
}

async function stubCancelPicker() {
  await evaluate(`(() => {
    window.__streamChunks = []
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      writable: true,
      value: async () => {
        throw new DOMException('canceled', 'AbortError')
      },
    })
  })()`)
}

async function disableFilePicker() {
  await evaluate(`(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      writable: true,
      value: undefined,
    })
  })()`)
}

async function disableOpfs() {
  await evaluate(`(() => {
    Object.defineProperty(navigator.storage, 'getDirectory', {
      configurable: true,
      value: async () => {
        throw new Error('opfs disabled')
      },
    })
  })()`)
}

async function streamedZipBase64() {
  return evaluate(`(async () => {
    const chunks = window.__streamChunks
    const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    let binary = ''
    for (let i = 0; i < merged.length; i += 0x8000) {
      binary += String.fromCharCode(...merged.subarray(i, i + 0x8000))
    }
    return btoa(binary)
  })()`)
}

async function verifyZip(base64, label) {
  const zip = await JSZip.loadAsync(Buffer.from(base64, 'base64'))
  const names = Object.keys(zip.files)
  assert.ok(names.includes('manifest.json'), `${label} 缺少 manifest.json`)
  assert.ok(
    names.some((name) => name.startsWith('notes/') && name.endsWith('.md')),
    `${label} 缺少 Markdown 文档`,
  )
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'))
  assert.equal(manifest.format, 'ainoteBook-backup')
  assert.ok(manifest.nodes.length > 0, `${label} manifest 节点为空`)
  return zip
}

function snapshotDownloads() {
  const snapshot = new Map()
  for (const file of fs.readdirSync(downloadDir)) {
    if (!file.endsWith('.zip') || file.endsWith('.crdownload')) continue
    const stat = fs.statSync(path.join(downloadDir, file))
    snapshot.set(file, `${stat.size}:${stat.mtimeMs}`)
  }
  return snapshot
}

async function waitForNewZip(before) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const [file, signature] of snapshotDownloads()) {
      if (before.get(file) === signature) continue
      const full = path.join(downloadDir, file)
      if (fs.statSync(full).size > 0) return full
    }
    await sleep(300)
  }
  throw new Error('等待流式导出下载超时')
}

async function opfsTempFiles() {
  return evaluate(`(async () => {
    const root = await navigator.storage.getDirectory()
    const names = []
    for await (const [name] of root.entries()) names.push(name)
    return names.filter((name) => name.startsWith('.ainb-backup-'))
  })()`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `localStorage.removeItem('ainb.backup.v1')`,
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
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url: URL })
await waitFor(`Boolean(document.querySelector('.sidebar')) && !document.querySelector('.loading-screen')`)

const tree = await readTree()
const activeDocCount = tree.filter((node) => node.kind === 'doc' && !node.deletedAt).length
assert.ok(activeDocCount > 0, '种子数据没有文档')

const labels = await openBackupMenu()
for (const label of [
  '导出全部笔记',
  '流式导出全部笔记',
  '从备份恢复',
  '流式从备份恢复',
]) {
  assert.ok(labels.some((item) => item.includes(label)), `备份菜单缺少「${label}」：${labels.join(' / ')}`)
}
await evaluate(
  `document.querySelector('.menu-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
)

// 1. FSA 主路径：stub 保存选择器，收集 chunk
await stubFilePicker()
await openBackupMenu()
await clickMenuItem('流式导出全部笔记')
await waitFor(`window.__streamClosed === true`, 60000)
await waitFor(
  `JSON.parse(localStorage.getItem('ainb.backup.v1') ?? '{}').lastBackupDocCount === ${activeDocCount}`,
)
const fsaBase64 = await streamedZipBase64()
const fsaZip = await verifyZip(fsaBase64, 'FSA 流式导出')
const fsaManifestDocs = JSON.parse(
  await fsaZip.file('manifest.json').async('string'),
).counts.docs
const streamImportPath = path.join(downloadDir, 'stream-import.zip')
fs.writeFileSync(streamImportPath, Buffer.from(fsaBase64, 'base64'))

// 2. 用户取消：不应生成下载，也不应更新备份记录
const recordBeforeCancel = await evaluate(`localStorage.getItem('ainb.backup.v1')`)
await stubCancelPicker()
await openBackupMenu()
await clickMenuItem('流式导出全部笔记')
await waitFor(`document.querySelector('.backup-menu-button')?.disabled === false`)
assert.equal(
  await evaluate(`window.__streamChunks.length`),
  0,
  '取消选择后不应写入任何 chunk',
)
assert.equal(
  await evaluate(`localStorage.getItem('ainb.backup.v1')`),
  recordBeforeCancel,
  '取消选择后不应更新备份记录',
)

// 3. OPFS 回退：无 FSA 时写临时文件后下载，并在延迟后清理
await disableFilePicker()
const beforeOpfsDownload = snapshotDownloads()
await openBackupMenu()
await clickMenuItem('流式导出全部笔记')
let opfsZipPath
try {
  opfsZipPath = await waitForNewZip(beforeOpfsDownload)
} catch (error) {
  console.log(
    'OPFS failure:',
    await evaluate(`({
      picker: typeof window.showSaveFilePicker,
      toast: document.querySelector('.toast')?.textContent ?? '',
      busy: document.querySelector('.backup-menu-button')?.disabled,
    })`),
    consoleErrors,
    fs.readdirSync(downloadDir),
  )
  throw error
}
const opfsZip = await JSZip.loadAsync(fs.readFileSync(opfsZipPath))
assert.ok(Object.keys(opfsZip.files).includes('manifest.json'), 'OPFS 回退 ZIP 缺少 manifest')
await sleep(6200)
assert.deepEqual(await opfsTempFiles(), [], 'OPFS 临时文件未清理')

// 4. Blob 回退：OPFS 不可用时仍能下载
await disableOpfs()
const beforeBlobDownload = snapshotDownloads()
await openBackupMenu()
await clickMenuItem('流式导出全部笔记')
const blobZipPath = await waitForNewZip(beforeBlobDownload)
const blobZip = await JSZip.loadAsync(fs.readFileSync(blobZipPath))
assert.ok(Object.keys(blobZip.files).includes('manifest.json'), 'Blob 回退 ZIP 缺少 manifest')

// 5. 流式导入：备份菜单项，选择 FSA 生成的流式 ZIP
const treeBeforeImport = await readTree()
const docsBeforeImport = countDocs(treeBeforeImport)
await openBackupMenu()
await clickMenuItem('流式从备份恢复')
await send('DOM.enable')
const { root } = await send('DOM.getDocument', { depth: -1 })
const { nodeId } = await send('DOM.querySelector', {
  nodeId: root.nodeId,
  selector: 'input.backup-restore-input',
})
assert.ok(nodeId, '未找到备份恢复输入框')
await send('DOM.setFileInputFiles', { nodeId, files: [streamImportPath] })
await waitFor(`Boolean(document.querySelector('.dialog-message'))`)
const importMessage = await evaluate(
  `document.querySelector('.dialog-message')?.textContent ?? ''`,
)
assert.ok(
  importMessage.includes('备份时间'),
  `流式恢复确认信息不完整：${importMessage}`,
)
await evaluate(`document.querySelector('.dialog-actions button:last-child').click()`)
await waitFor(`!document.querySelector('.dialog-backdrop')`)
const treeAfterImport = await waitForTree(
  (tree) => countDocs(tree) === docsBeforeImport + fsaManifestDocs,
)
assert.ok(
  treeAfterImport.some(
    (node) => node.kind === 'folder' && node.name.startsWith('备份恢复'),
  ),
  '流式恢复缺少恢复文件夹',
)

console.log('控制台错误:', consoleErrors)
console.log('流式导出/导入检查通过')
assert.deepEqual(consoleErrors, [])

ws.close()
chrome.kill()
await sleep(500)
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  // 临时目录稍后清理
}
