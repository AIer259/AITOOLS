import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CDP_PORT || 9336)
const URL = process.env.APP_URL || 'http://localhost:5174'
const profile = path.join(os.tmpdir(), `ainb-chrome-asset-refs-${Date.now()}`)

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
    // Chrome 可能已退出
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

  if (message.method === 'Page.loadEventFired') {
    loadEvents += 1
  }
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

async function waitFor(expression, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return
    } catch {
      // 页面跳转中执行上下文会被销毁，继续轮询
    }
    await sleep(100)
  }
  throw new Error(`等待超时: ${expression}`)
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
const keyMissingExpr = (key) => `${readKeyExpr(key)}.then((value) => value === null)`

async function hasKey(key) {
  return evaluate(`new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('keyval', 'readonly')
      const get = tx.objectStore('keyval').getKey(${JSON.stringify(key)})
      get.onsuccess = () => resolve(get.result !== undefined)
      get.onerror = () => reject(get.error)
    }
    req.onerror = () => reject(req.error)
  })`)
}

async function deleteKeys(keys) {
  return evaluate(`new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('keyval', 'readwrite')
      const store = tx.objectStore('keyval')
      for (const key of ${JSON.stringify(keys)}) store.delete(key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })`)
}

async function ageAssets(assetIds) {
  return evaluate(`new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('keyval', 'readwrite')
      const store = tx.objectStore('keyval')
      const get = store.get('ainb.assets.meta')
      get.onsuccess = () => {
        const ids = new Set(${JSON.stringify(assetIds)})
        const index = (get.result ?? []).map((asset) =>
          ids.has(asset.id) ? { ...asset, lastUsedAt: 0 } : asset,
        )
        store.put(index, 'ainb.assets.meta')
        tx.oncomplete = () => resolve(true)
      }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })`)
}

function collectAssetIds(content) {
  const ids = []
  const visit = (node) => {
    if (!node) return
    if (node.type === 'noteImage' && node.attrs?.assetId) ids.push(node.attrs.assetId)
    node.content?.forEach(visit)
  }
  visit(content)
  return ids
}

async function createNote(name) {
  await evaluate(`document.querySelectorAll('.section-add')[0].click()`)
  await waitFor(`Boolean(document.querySelector('.popup-menu'))`)
  await evaluate(`document.querySelector('.popup-menu button').click()`)
  await waitFor(`Boolean(document.querySelector('.dialog input'))`)
  await evaluate(`(() => {
    const input = document.querySelector('.dialog input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(name)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await evaluate(`(() => {
    const buttons = document.querySelectorAll('.dialog-actions button')
    buttons[buttons.length - 1].click()
  })()`)
  await waitFor(`!document.querySelector('.dialog-backdrop')`)
  await waitFor(`document.querySelector('.note-title')?.value === ${JSON.stringify(name)}`)
  await sleep(900)
}

async function pasteImage(color) {
  const accepted = await evaluate(`(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 140
    const context = canvas.getContext('2d')
    context.fillStyle = ${JSON.stringify(color)}
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#ffffff'
    context.font = '24px sans-serif'
    context.fillText('图片', 56, 80)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const file = new File([blob], 'paste.png', { type: 'image/png' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    const event = new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    })
    document.querySelector('.ProseMirror')?.dispatchEvent(event)
    return event.defaultPrevented
  })()`)
  assert.ok(accepted, '粘贴事件没有被图片处理器接收')
  await sleep(900)
}

const rowExists = (name) =>
  `[...document.querySelectorAll('.tree-row')].some((row) => row.querySelector('.row-name')?.textContent === ${JSON.stringify(name)})`

async function deleteFromSidebar(name) {
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(
      (item) => item.querySelector('.row-name')?.textContent === ${JSON.stringify(name)},
    )
    row?.querySelector('.row-action[title="更多"]')?.click()
  })()`)
  await waitFor(`Boolean(document.querySelector('.popup-menu'))`)
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.popup-menu button')].find(
      (item) => item.textContent?.includes('移到回收站'),
    )
    button?.click()
  })()`)
  await waitFor(`Boolean(document.querySelector('.dialog-message'))`)
  await evaluate(`document.querySelector('.dialog-actions button:last-child').click()`)
  await waitFor(`!document.querySelector('.dialog-backdrop')`)
  await sleep(900)
}

async function purgeTrashItem(name) {
  await evaluate(`(() => {
    const item = [...document.querySelectorAll('.trash-item')].find(
      (row) => row.querySelector('.trash-name')?.textContent === ${JSON.stringify(name)},
    )
    item?.querySelector('.btn.danger-ghost')?.click()
  })()`)
  await waitFor(`Boolean(document.querySelector('.dialog-message'))`)
  await evaluate(`document.querySelector('.dialog-actions button:last-child').click()`)
  await waitFor(`!document.querySelector('.dialog-backdrop')`)
  await sleep(900)
}

async function treeNodes() {
  return (await readKey('ainb.tree.v2')) ?? []
}

const refKey = (id) => `ainb.assetRef.${id}`
const blobKey = (id) => `ainb.asset.${id}`

await send('Page.enable')
await send('Runtime.enable')
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__idbWrites = []
    window.__idbReads = []
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, key) {
      try { window.__idbWrites.push(String(key)) } catch (error) {}
      return originalPut.apply(this, arguments)
    }
    const originalGet = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key) {
      try { window.__idbReads.push(String(key)) } catch (error) {}
      return originalGet.apply(this, arguments)
    }`,
})
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url: URL })
await waitFor(`Boolean(document.querySelector('.sidebar')) && !document.querySelector('.loading-screen')`)

// 首次启动：为存量正文建立引用索引
await waitFor(keyExistsExpr('ainb.assetRefs.v1'), 20000)
const refsMeta = await readKey('ainb.assetRefs.v1')
assert.equal(refsMeta.version, 1, '引用索引版本不正确')

// P1：输入只写正文与引用，不重写整棵树
await createNote('资源测试')
let tree = await treeNodes()
const doc1 = tree.find((node) => node.name === '资源测试')
assert.ok(doc1, '未找到新建文档')

// 新建时已写过引用键；接下来纯文字输入不应再写
await evaluate(`window.__idbWrites = []`)
await evaluate(`document.querySelector('.ProseMirror').focus()`)
await send('Input.insertText', { text: '正文更新' })
await sleep(1200)

const writes = await evaluate(`window.__idbWrites`)
assert.ok(
  writes.includes(`ainb.node.${doc1.id}`),
  `输入后未写入正文：${writes.join(', ')}`,
)
assert.ok(
  !writes.includes('ainb.tree.v2'),
  `纯输入不应重写整棵树：${writes.join(', ')}`,
)

// 第二次纯文字输入：引用键已被写入过，不再重复写
await evaluate(`window.__idbWrites = []`)
await send('Input.insertText', { text: '，再次输入' })
await sleep(1200)
const writes2 = await evaluate(`window.__idbWrites`)
assert.ok(
  !writes2.includes(`ainb.assetRef.${doc1.id}`),
  `无图片变化的纯输入不应重写引用键：${writes2.join(', ')}`,
)
const doc1Content = await readKey(`ainb.node.${doc1.id}`)
assert.ok(JSON.stringify(doc1Content).includes('正文更新'), '正文未持久化')

// P2：两篇文档共用一张图，另一张图只属于第二篇
await evaluate(`window.__idbWrites = []`)
await pasteImage('#2f6fed')
await waitFor(`document.querySelectorAll('.note-image').length === 1`)
const writesAfterImage = await evaluate(`window.__idbWrites`)
assert.ok(
  writesAfterImage.includes(`ainb.assetRef.${doc1.id}`),
  `插入图片后应写引用键：${writesAfterImage.join(', ')}`,
)
const blueInDoc1 = collectAssetIds(await readKey(`ainb.node.${doc1.id}`))
assert.equal(blueInDoc1.length, 1, '第一篇文档应有 1 张图片')

await createNote('资源测试二')
await pasteImage('#2f6fed')
await pasteImage('#f08a24')
await waitFor(`document.querySelectorAll('.note-image').length === 2`)

tree = await treeNodes()
const doc2 = tree.find((node) => node.name === '资源测试二')
assert.ok(doc2, '未找到第二篇文档')
const doc2Assets = collectAssetIds(await readKey(`ainb.node.${doc2.id}`))
assert.equal(doc2Assets.length, 2, '第二篇文档应有 2 张图片')
const blueId = blueInDoc1[0]
assert.equal(doc2Assets[0], blueId, '相同图片应复用同一个资源 id')
const orangeId = doc2Assets.find((id) => id !== blueId)
assert.ok(orangeId, '未找到橙色图片资源')

assert.deepEqual(await readKey(refKey(doc1.id)), [blueId], '第一篇文档引用键不正确')
assert.deepEqual(
  new Set(await readKey(refKey(doc2.id))),
  new Set([blueId, orangeId]),
  '第二篇文档引用键不正确',
)

// 索引丢失后启动重建，且重建后 GC 不会误删
await ageAssets([blueId, orangeId])
await deleteKeys(['ainb.assetRefs.v1', refKey(doc1.id), refKey(doc2.id)])
await reloadPage()
await waitFor(keyExistsExpr('ainb.assetRefs.v1'), 20000)
await waitFor(keyExistsExpr(refKey(doc1.id)), 20000)
await waitFor(keyExistsExpr(refKey(doc2.id)), 20000)
await sleep(1200)
assert.ok(await hasKey(blobKey(blueId)), '重建引用索引后蓝色图片被误删')
assert.ok(await hasKey(blobKey(orangeId)), '重建引用索引后橙色图片被误删')

// 索引已就绪时再次启动：不重建、不读取其他文档正文
const markerBefore = await readKey('ainb.assetRefs.v1')
await reloadPage()
await sleep(1500)
const startupReads = await evaluate('window.__idbReads')
const nodeReads = [
  ...new Set(startupReads.filter((key) => key.startsWith('ainb.node.'))),
]
assert.ok(
  nodeReads.length <= 1,
  `启动读取了过多正文：${nodeReads.join(', ')}`,
)
assert.ok(
  !nodeReads.includes(`ainb.node.${doc1.id}`),
  '启动不应读取非当前文档的正文',
)
const markerAfter = await readKey('ainb.assetRefs.v1')
assert.equal(
  markerAfter.updatedAt,
  markerBefore.updatedAt,
  '引用索引已就绪时不应重复重建',
)

// 回收站中的文档仍算引用：只被回收站文档引用的图片不能删
await deleteFromSidebar('资源测试二')
assert.ok(!(await evaluate(rowExists('资源测试二'))), '文档未移入回收站')
await reloadPage()
await sleep(1200)
assert.ok(
  await readKey(refKey(doc2.id)),
  '回收站文档的引用键不应被删除',
)
assert.ok(await hasKey(blobKey(orangeId)), '只被回收站文档引用的图片被误删')

// 永久删除后：橙色图片不再被引用，启动清理应删除；蓝色仍被第一篇引用
await evaluate(`document.querySelector('.sidebar-trash').click()`)
await waitFor(`Boolean(document.querySelector('.trash-view'))`)
await purgeTrashItem('资源测试二')
await waitFor(keyMissingExpr(refKey(doc2.id)), 10000)
await reloadPage()
await sleep(1500)
assert.equal(await hasKey(blobKey(orangeId)), false, '无引用的橙色图片未被清理')
assert.ok(await hasKey(blobKey(blueId)), '仍被引用的蓝色图片被误删')

// 永久删除第一篇后，蓝色图片才可清理
await deleteFromSidebar('资源测试')
assert.ok(!(await evaluate(rowExists('资源测试'))), '第一篇文档未移入回收站')
await evaluate(`document.querySelector('.sidebar-trash').click()`)
await waitFor(`Boolean(document.querySelector('.trash-view'))`)
await purgeTrashItem('资源测试')
await waitFor(keyMissingExpr(refKey(doc1.id)), 10000)
await reloadPage()
await sleep(1500)
assert.equal(await hasKey(blobKey(blueId)), false, '无引用的蓝色图片未被清理')

console.log('控制台错误:', consoleErrors)
console.log('图片引用索引与保存拆分检查通过')
assert.deepEqual(consoleErrors, [])

ws.close()
chrome.kill()
await sleep(500)
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  // 临时目录稍后清理
}
