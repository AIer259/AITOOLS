import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CDP_PORT || 9342)
const URL = process.env.APP_URL || 'http://localhost:5174'
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-search-profile-'))

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
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    // 临时目录稍后清理
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

async function reloadPage() {
  const before = loadEvents
  await send('Page.reload', { ignoreCache: true })
  const deadline = Date.now() + 15000
  while (loadEvents <= before && Date.now() < deadline) await sleep(50)
  assert.ok(loadEvents > before, '页面刷新未完成')
  await waitFor(
    `Boolean(document.querySelector('.sidebar')) && !document.querySelector('.loading-screen')`,
  )
}

async function waitFor(expression, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return
    } catch {
      // 页面刷新中继续轮询
    }
    await sleep(100)
  }
  throw new Error(`等待超时：${expression}`)
}

const readKeyExpr = (key) => `new Promise((resolve, reject) => {
  const req = indexedDB.open('keyval-store')
  req.onsuccess = () => {
    const db = req.result
    const tx = db.transaction('keyval', 'readonly')
    const get = tx.objectStore('keyval').get(${JSON.stringify(key)})
    get.onsuccess = () => resolve(get.result ?? null)
    get.onerror = () => reject(get.error)
  }
  req.onerror = () => reject(req.error)
})`

async function readKey(key) {
  return evaluate(readKeyExpr(key))
}

const keyExistsExpr = (key) => `${readKeyExpr(key)}.then(Boolean)`

async function setInput(selector, value) {
  await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

async function openGlobalSearch() {
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'k',
    ctrlKey: true,
    bubbles: true,
  }))`)
  await waitFor(`Boolean(document.querySelector('.global-search-dialog'))`)
  await waitFor(`Boolean(document.querySelector('.global-search-input'))`)
}

async function resultNames() {
  return evaluate(
    `[...document.querySelectorAll('.global-search-name')].map((el) => el.textContent ?? '')`,
  )
}

async function clickResult(name) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.global-search-result')].find(
      (item) => item.querySelector('.global-search-name')?.textContent === ${JSON.stringify(name)},
    )
    button?.click()
  })()`)
}

async function clickTreeRow(name) {
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(
      (item) => item.querySelector('.row-name')?.textContent === ${JSON.stringify(name)},
    )
    row?.click()
  })()`)
  await waitFor(`document.querySelector('.note-title')?.value === ${JSON.stringify(name)}`)
}

const contentA = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '跨文档搜索关键词 苹果 AlphaNeedle' }] },
  ],
}
const contentB = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '另一个文档 苹果 苹果 苹果' }] },
  ],
}
const contentTrash = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '苹果 只应在回收站' }] }],
}

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
    id: 'doc-a',
    area: 'space',
    parentId: 'folder-a',
    kind: 'doc',
    name: '甲文档',
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
    name: '乙文档',
    order: 'a2',
    docType: 'md',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'doc-trash',
    area: 'private',
    parentId: null,
    kind: 'doc',
    name: '回收站文档',
    order: 'a1',
    docType: 'md',
    deletedAt: now,
    createdAt: now,
    updatedAt: now,
  },
]

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url: URL })
await waitFor(`Boolean(document.querySelector('.sidebar'))`)
// 等首次启动的索引扫描完成，避免它在本测试清库后回写标记
await waitFor(keyExistsExpr('ainb.assetRefs.v1'), 20000)
await waitFor(keyExistsExpr('ainb.searchIndex.v1'), 20000)

await evaluate(`new Promise((resolve, reject) => {
  const req = indexedDB.open('keyval-store')
  req.onupgradeneeded = () => req.result.createObjectStore('keyval')
  req.onsuccess = () => {
    const db = req.result
    const tx = db.transaction('keyval', 'readwrite')
    const store = tx.objectStore('keyval')
    store.clear()
    store.put(${JSON.stringify(tree)}, 'ainb.tree.v2')
    store.put(${JSON.stringify(contentA)}, 'ainb.node.doc-a')
    store.put(${JSON.stringify(contentB)}, 'ainb.node.doc-b')
    store.put(${JSON.stringify(contentTrash)}, 'ainb.node.doc-trash')
    tx.oncomplete = () => {
      localStorage.setItem('ainb.active.v1', 'doc-a')
      resolve(true)
    }
    tx.onerror = () => reject(tx.error)
  }
  req.onerror = () => reject(req.error)
})`)

await reloadPage()
await waitFor(`document.querySelector('.note-title')?.value === '甲文档'`)

// 首次共用扫描：两个索引标记与搜索键都应生成
await waitFor(keyExistsExpr('ainb.assetRefs.v1'), 20000)
await waitFor(keyExistsExpr('ainb.searchIndex.v1'), 20000)
await waitFor(keyExistsExpr('ainb.search.doc-a'), 20000)

// 中文与英文跨文档命中，回收站文档排除
await openGlobalSearch()
await setInput('.global-search-input', '苹果')
await waitFor(`document.querySelectorAll('.global-search-result').length >= 2`)
const appleNames = await resultNames()
assert.ok(appleNames.includes('甲文档'), `缺少甲文档：${appleNames.join(', ')}`)
assert.ok(appleNames.includes('乙文档'), `缺少乙文档：${appleNames.join(', ')}`)
assert.ok(!appleNames.includes('回收站文档'), '回收站文档不应出现在全局搜索结果中')

const pathText = await evaluate(
  `[...document.querySelectorAll('.global-search-result')]
    .find((item) => item.querySelector('.global-search-name')?.textContent === '甲文档')
    ?.querySelector('.global-search-path')?.textContent ?? ''`,
)
assert.ok(pathText.includes('空间') && pathText.includes('资料'), `路径不正确：${pathText}`)
assert.ok(
  await evaluate(`Boolean(document.querySelector('.global-search-snippet mark'))`),
  '结果片段未高亮命中词',
)

await setInput('.global-search-input', 'AlphaNeedle')
await waitFor(`document.querySelectorAll('.global-search-result').length === 1`)
assert.deepEqual(await resultNames(), ['甲文档'])

// 点击结果：关闭弹窗、打开文档、跳到第一处并高亮
await setInput('.global-search-input', '苹果')
await waitFor(`document.querySelectorAll('.global-search-result').length >= 2`)
await clickResult('乙文档')
await waitFor(`!document.querySelector('.global-search-dialog')`)
await waitFor(
  `document.querySelector('.note-title')?.value === '乙文档'
    && Boolean(document.querySelector('.search-panel'))
    && Boolean(document.querySelector('.search-hit.current'))`,
)

// 编辑后增量索引生效
await clickTreeRow('甲文档')
await evaluate(`document.querySelector('.ProseMirror').focus()`)
await send('Input.insertText', { text: ' 新词增量命中' })
await sleep(1200)
await openGlobalSearch()
await setInput('.global-search-input', '新词增量')
await waitFor(`document.querySelectorAll('.global-search-result').length === 1`)
assert.deepEqual(await resultNames(), ['甲文档'])

// 当前文档搜索仍可用
await evaluate(`document.querySelector('.global-search-close').click()`)
await waitFor(`!document.querySelector('.global-search-dialog')`)
await evaluate(`document.querySelector('.search-icon-btn[title="关闭搜索"]')?.click()`)
await evaluate(`document.querySelector('button[title="搜索当前文档"]').click()`)
await waitFor(`Boolean(document.querySelector('.search-panel'))`)
await setInput('.search-panel input', '新词增量')
await waitFor(`Boolean(document.querySelector('.search-hit.current'))`)

console.log('控制台错误:', consoleErrors)
console.log('全局搜索检查通过')
assert.deepEqual(consoleErrors, [])

ws.close()
chrome.kill()
await sleep(500)
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  // 临时目录稍后清理
}
