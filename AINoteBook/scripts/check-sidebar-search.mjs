import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9346
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-sidebar-search-'))

const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
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
})

let wsUrl = null
for (let i = 0; i < 60; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    const targets = await res.json()
    const page = targets.find((t) => t.type === 'page')
    if (page) {
      wsUrl = page.webSocketDebuggerUrl
      break
    }
  } catch {
    // Chrome 尚未就绪
  }
  await sleep(200)
}
if (!wsUrl) throw new Error('无法连接 Chrome')

const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let seq = 0
const pending = new Map()
const errors = []

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id) {
    const cb = pending.get(msg.id)
    if (!cb) return
    pending.delete(msg.id)
    if (msg.error) cb.reject(new Error(msg.error.message))
    else cb.resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
}

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    ws.send(JSON.stringify({ id, method, params }))
    pending.set(id, { resolve, reject })
  })

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url: 'http://localhost:4173' })

const deadline = Date.now() + 20000
while (Date.now() < deadline) {
  if (
    await evaluate(
      `Boolean(document.querySelector('.sidebar') && !document.querySelector('.loading-screen'))`,
    )
  )
    break
  await sleep(200)
}

// 按钮存在且位于「空间」标题之前
const order = await evaluate(`(() => {
  const btn = document.querySelector('.sidebar-global-search')
  const space = [...document.querySelectorAll('.section-title')].find(
    (el) => el.textContent === '空间',
  )
  if (!btn || !space) return { missing: !btn ? 'button' : 'space' }
  return {
    ok: Boolean(btn.compareDocumentPosition(space) & Node.DOCUMENT_POSITION_FOLLOWING),
    label: btn.textContent.trim(),
  }
})()`)
if (!order.ok) throw new Error(`按钮位置或元素缺失: ${JSON.stringify(order)}`)

// 点击后打开全局搜索弹窗
await evaluate(`document.querySelector('.sidebar-global-search').click()`)
let opened = false
const openDeadline = Date.now() + 10000
while (Date.now() < openDeadline) {
  if (
    await evaluate(
      `Boolean(document.querySelector('.global-search-dialog') && document.querySelector('.global-search-input'))`,
    )
  ) {
    opened = true
    break
  }
  await sleep(150)
}
if (!opened) throw new Error('点击侧栏按钮未打开全局搜索弹窗')

// 输入关键词应有结果
await evaluate(`(() => {
  const input = document.querySelector('.global-search-input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '本地优先')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
await sleep(800)
const count = await evaluate(`document.querySelectorAll('.global-search-result').length`)
if (count === 0) throw new Error('搜索无结果')

// Esc 关闭
await evaluate(
  `document.querySelector('.global-search-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
)
let closed = false
const closeDeadline = Date.now() + 5000
while (Date.now() < closeDeadline) {
  if (await evaluate(`!document.querySelector('.global-search-dialog')`)) {
    closed = true
    break
  }
  await sleep(150)
}
if (!closed) throw new Error('Esc 未关闭弹窗')

console.log('侧栏全局搜索按钮检查通过，结果数:', count)
console.log('控制台错误:', errors)
if (errors.length > 0) process.exit(1)

ws.close()
chrome.kill()
await sleep(400)
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  // 临时目录稍后清理
}
