import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CDP_PORT || 9334)
const URL = process.env.APP_URL || 'http://localhost:5174'
const profile = path.resolve(`.tmp-chrome-trash-${Date.now()}`)
const shotDir = path.resolve('.tmp-shots')
fs.mkdirSync(shotDir, { recursive: true })
const shot = path.join(shotDir, 'trash.png')

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

const rowExists = (name) =>
  `[...document.querySelectorAll('.tree-row')].some((row) => row.querySelector('.row-name')?.textContent === ${JSON.stringify(name)})`
const trashCount = `document.querySelector('.trash-count')?.textContent ?? ''`
const trashNameExists = (name) =>
  `[...document.querySelectorAll('.trash-name')].some((el) => el.textContent === ${JSON.stringify(name)})`

async function readTree() {
  return evaluate(`new Promise((resolve, reject) => {
    const req = indexedDB.open('keyval-store')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('keyval', 'readonly')
      const get = tx.objectStore('keyval').get('ainb.tree.v2')
      get.onsuccess = () => resolve(get.result ?? null)
      get.onerror = () => reject(get.error)
    }
    req.onerror = () => reject(req.error)
  })`)
}

async function openMoreMenu(name) {
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(
      (item) => item.querySelector('.row-name')?.textContent === ${JSON.stringify(name)},
    )
    row?.querySelector('.row-action[title="更多"]')?.click()
  })()`)
  await waitFor(`Boolean(document.querySelector('.popup-menu'))`)
}

async function chooseMenu(label) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.popup-menu button')].find(
      (item) => item.textContent?.includes(${JSON.stringify(label)}),
    )
    button?.click()
  })()`)
}

async function confirmDialog() {
  await waitFor(`Boolean(document.querySelector('.dialog-actions button:last-child'))`)
  const message = await evaluate(
    `document.querySelector('.dialog-message')?.textContent ?? ''`,
  )
  await evaluate(`document.querySelector('.dialog-actions button:last-child').click()`)
  await waitFor(`!document.querySelector('.dialog-backdrop')`)
  return message
}

async function deleteFromSidebar(name) {
  await openMoreMenu(name)
  await chooseMenu('移到回收站')
  await waitFor(`Boolean(document.querySelector('.dialog-message'))`)
  const message = await evaluate(
    `document.querySelector('.dialog-message')?.textContent ?? ''`,
  )
  await evaluate(`document.querySelector('.dialog-actions button:last-child').click()`)
  await waitFor(`!document.querySelector('.dialog-backdrop')`)
  return message
}

async function openTrash() {
  await evaluate(`document.querySelector('.sidebar-trash').click()`)
  await waitFor(`Boolean(document.querySelector('.trash-view'))`)
  assert.equal(
    await evaluate(`document.querySelector('.backup-menu-button')?.offsetParent === null`),
    true,
    '回收站视图不应显示顶栏备份按钮',
  )
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url: URL })
await waitFor(
  `Boolean(document.querySelector('.sidebar') && !document.querySelector('.loading-screen'))`,
)

assert.equal(await evaluate(trashCount), '0', '初始回收站数量应为 0')
assert.ok(
  await evaluate(`Boolean(document.querySelector('.sidebar-trash'))`),
  '侧栏缺少回收站入口',
)

// 注入一份带附件文件夹的主文档，验证嵌套关系
await evaluate(`new Promise((resolve, reject) => {
  const req = indexedDB.open('keyval-store')
  req.onsuccess = () => {
    const db = req.result
    const tx = db.transaction('keyval', 'readwrite')
    const store = tx.objectStore('keyval')
    const get = store.get('ainb.tree.v2')
    get.onsuccess = () => {
      const nodes = get.result ?? []
      const now = Date.now()
      nodes.push(
        {
          id: 'trash-main', area: 'private', parentId: null, kind: 'doc',
          name: '带附件文档', order: 'z1', docType: 'md',
          attachmentFolderId: 'trash-attach', createdAt: now, updatedAt: now,
        },
        {
          id: 'trash-attach', area: 'private', parentId: null, kind: 'folder',
          name: '带附件文档附件', order: 'z2', ownerDocId: 'trash-main',
          createdAt: now, updatedAt: now,
        },
        {
          id: 'trash-embed', area: 'private', parentId: 'trash-attach', kind: 'doc',
          name: '嵌入文档', order: 'z1', docType: 'md',
          createdAt: now, updatedAt: now,
        },
      )
      store.put(nodes, 'ainb.tree.v2')
      tx.oncomplete = () => resolve(true)
    }
  }
  req.onerror = () => reject(req.error)
})`)
await reloadPage()
await waitFor(
  `Boolean(document.querySelector('.sidebar'))
    && !document.querySelector('.loading-screen')
    && ${rowExists('带附件文档')}`,
)
assert.ok(await evaluate(rowExists('带附件文档附件')), '附件文件夹未显示')

// 附件文件夹不能单独删除：菜单中不应出现回收站选项
await openMoreMenu('带附件文档附件')
const attachmentMenu = await evaluate(
  `[...document.querySelectorAll('.popup-menu button')].map((item) => item.textContent?.trim() ?? '')`,
)
assert.ok(
  !attachmentMenu.some((label) => label.includes('回收站')),
  `附件文件夹不应提供单独删除：${attachmentMenu.join(' / ')}`,
)
await evaluate(
  `document.querySelector('.menu-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
)
await waitFor(`!document.querySelector('.popup-menu')`)

const deleteMessage = await deleteFromSidebar('带附件文档')
assert.ok(
  deleteMessage.includes('附件文件夹'),
  `删除提示未说明附件文件夹：${deleteMessage}`,
)
await waitFor(`!${rowExists('带附件文档')} && !${rowExists('带附件文档附件')}`)
assert.equal(await evaluate(trashCount), '1', '删除后回收站数量应为 1')

// 刷新后回收站仍保留
await sleep(800)
await reloadPage()
await waitFor(
  `Boolean(document.querySelector('.sidebar')) && !document.querySelector('.loading-screen')`,
)
assert.equal(await evaluate(trashCount), '1', '刷新后回收站数量应保留')

await openTrash()
assert.ok(await evaluate(trashNameExists('带附件文档')), '回收站缺少主文档')
assert.ok(await evaluate(trashNameExists('带附件文档附件')), '回收站缺少附件文件夹子行')
assert.equal(
  await evaluate(`Boolean(document.querySelector('.trash-child .danger-ghost'))`),
  false,
  '附件文件夹子行不应提供永久删除',
)

const shotData = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(shot, Buffer.from(shotData.data, 'base64'))

// 点附件文件夹的恢复按钮，应提示主文档并恢复整包
await evaluate(`(() => {
  const child = document.querySelector('.trash-child')
  child?.querySelector('.btn')?.click()
})()`)
const restoreMessage = await evaluate(
  `document.querySelector('.dialog-message')?.textContent ?? ''`,
)
assert.ok(
  restoreMessage.includes('带附件文档'),
  `恢复提示未包含主文档名：${restoreMessage}`,
)
await evaluate(`document.querySelector('.dialog-actions button:last-child').click()`)
await waitFor(`!document.querySelector('.dialog-backdrop') && !${trashNameExists('带附件文档')}`)
assert.ok(await evaluate(rowExists('带附件文档')), '恢复后主文档未回到侧栏')
assert.ok(await evaluate(rowExists('带附件文档附件')), '恢复后附件文件夹未回到侧栏')
assert.equal(await evaluate(trashCount), '0', '恢复后回收站应为空')

// 再次删除并永久删除主文档
await deleteFromSidebar('带附件文档')
await waitFor(`!${rowExists('带附件文档')}`)
await openTrash()

await evaluate(`document.querySelector('.trash-item .btn.danger-ghost').click()`)
const purgeMessage = await evaluate(
  `document.querySelector('.dialog-message')?.textContent ?? ''`,
)
assert.ok(
  purgeMessage.includes('附件文件夹') && purgeMessage.includes('无法恢复'),
  `永久删除提示不完整：${purgeMessage}`,
)
await evaluate(`document.querySelector('.dialog-actions button:last-child').click()`)
await waitFor(`!document.querySelector('.dialog-backdrop') && Boolean(document.querySelector('.trash-empty'))`)

await sleep(700)
const treeAfterPurge = await readTree()
const idsAfterPurge = new Set((treeAfterPurge ?? []).map((node) => node.id))
for (const id of ['trash-main', 'trash-attach', 'trash-embed']) {
  assert.ok(!idsAfterPurge.has(id), `永久删除后仍存在节点 ${id}`)
}

// 删除文件夹（整棵子树）并从回收站恢复
await deleteFromSidebar('入门指南')
await waitFor(`!${rowExists('入门指南')}`)
assert.equal(await evaluate(trashCount), '1')
await openTrash()
assert.ok(await evaluate(trashNameExists('入门指南')), '回收站缺少文件夹')
await evaluate(`document.querySelector('.trash-item .btn.ghost').click()`)
await waitFor(`!document.querySelector('.trash-item')`)
assert.ok(await evaluate(rowExists('入门指南')), '文件夹恢复后未回到侧栏')

// 清空回收站：错误输入禁用，正确输入后清空
await deleteFromSidebar('产品需求草稿')
await waitFor(`!${rowExists('产品需求草稿')}`)
await openTrash()
await evaluate(`document.querySelector('.trash-head .btn.danger').click()`)
await waitFor(`Boolean(document.querySelector('.dialog-expected'))`)

const expected = await evaluate(
  `document.querySelector('.dialog-expected code')?.textContent ?? ''`,
)
assert.equal(expected, '确认清空回收站', '验证短语不正确')
assert.equal(
  await evaluate(`document.querySelector('.dialog-actions button:last-child').disabled`),
  true,
  '未输入验证短语时确认按钮应禁用',
)

await evaluate(`(() => {
  const input = document.querySelector('.dialog input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '确认清空回收站')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
await waitFor(
  `document.querySelector('.dialog-actions button:last-child').disabled === false`,
)
await evaluate(`document.querySelector('.dialog-actions button:last-child').click()`)
await waitFor(`Boolean(document.querySelector('.trash-empty'))`)
assert.equal(await evaluate(trashCount), '0', '清空后回收站数量应为 0')

await sleep(700)
const finalTree = await readTree()
assert.ok(
  !(finalTree ?? []).some((node) => node.deletedAt),
  '清空后仍存在 deletedAt 节点',
)

console.log('控制台错误:', consoleErrors)
console.log('截图:', shot)
console.log('回收站检查通过')
assert.deepEqual(consoleErrors, [])

ws.close()
chrome.kill()
await sleep(500)
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  // 临时目录稍后清理
}
