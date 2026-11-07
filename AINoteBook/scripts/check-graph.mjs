import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5174'
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-chrome-graph-'))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir,
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1500, height: 1000 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

async function createNote(name) {
  const adds = await page.$$('.section-add')
  await adds[0].click()
  await page.waitForSelector('.popup-menu')
  const menuButtons = await page.$$('.popup-menu button')
  await menuButtons[0].click()
  await page.waitForSelector('.dialog input')
  await page.$eval(
    '.dialog input',
    (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    name,
  )
  const dialogButtons = await page.$$('.dialog-actions button')
  await dialogButtons[dialogButtons.length - 1].click()
  await page.waitForFunction(
    (expected) => document.querySelector('.note-title')?.value === expected,
    {},
    name,
  )
  await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)
}

async function createGraph(name) {
  const adds = await page.$$('.section-add')
  await adds[0].click()
  await page.waitForSelector('.section-menu')
  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.section-menu button')].find((item) =>
      item.textContent?.includes('新建关系图'),
    )
    button?.click()
    return Boolean(button)
  })
  assert.ok(clicked, '新建菜单缺少「新建关系图」')

  await page.waitForSelector('.dialog input')
  await page.$eval(
    '.dialog input',
    (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    name,
  )
  const dialogButtons = await page.$$('.dialog-actions button')
  await dialogButtons[dialogButtons.length - 1].click()
  await page.waitForFunction(
    (expected) => document.querySelector('.note-title')?.value === expected,
    {},
    name,
  )
  await page.waitForSelector('.graph-canvas')
}

async function addDocument(name) {
  await page.click('.graph-toolbar .btn.primary')
  await page.waitForSelector('.embed-picker')
  const clicked = await page.evaluate((docName) => {
    const item = [...document.querySelectorAll('.embed-picker .embed-item')].find(
      (element) => element.querySelector('.embed-item-name')?.textContent === docName,
    )
    item?.click()
    return Boolean(item)
  }, name)
  assert.ok(clicked, `选择器里没有「${name}」`)
  await page.waitForFunction(() => !document.querySelector('.embed-picker'))
}

async function nodeBox(index, dx = 20, dy = 30) {
  return page.$$eval(
    '.graph-node',
    (nodes, i, offsetX, offsetY) => {
      const rect = nodes[i].getBoundingClientRect()
      return { x: rect.x + offsetX, y: rect.y + offsetY }
    },
    index,
    dx,
    dy,
  )
}

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.paper')

  await createNote('文档甲')
  await createNote('文档乙')
  await createGraph('关系图测试')

  await addDocument('文档甲')
  await addDocument('文档乙')
  await page.waitForFunction(() => document.querySelectorAll('.graph-node').length === 2)

  // 连线：文档甲 → 文档乙
  const handle = await page.$eval('.graph-node .graph-node-link', (element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  const target = await nodeBox(1, 90, 30)
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 12 })
  await page.mouse.up()

  await page.waitForSelector('.graph-edge', { timeout: 10000 })
  const relations = await page.$$eval('.graph-node-relation', (elements) =>
    elements.map((element) => element.textContent?.trim() ?? ''),
  )
  assert.ok(
    relations.some((text) => text.includes('下级') && text.includes('文档甲')),
    `关系推导不正确：${JSON.stringify(relations)}`,
  )

  // 拖动节点：位置变化且不触发跳转
  const before = await nodeBox(1, 0, 0)
  await page.mouse.move(before.x + 20, before.y + 20)
  await page.mouse.down()
  await page.mouse.move(before.x + 160, before.y + 120, { steps: 12 })
  await page.mouse.up()
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '关系图测试',
    { timeout: 5000 },
  )
  const after = await page.$$eval('.graph-node', (nodes) => {
    const rect = nodes[1].getBoundingClientRect()
    return { x: rect.x, y: rect.y }
  })
  assert.ok(
    Math.abs(after.x - before.x) > 20 || Math.abs(after.y - before.y) > 20,
    `节点未拖动：${JSON.stringify({ before, after })}`,
  )

  // 等待图数据保存完成后再跳转
  await page.waitForFunction(
    () => document.querySelector('.save-state')?.textContent === '已保存',
    { timeout: 15000 },
  )

  // 点击节点跳转到对应文档
  await page.evaluate(() => {
    const name = document.querySelector('.graph-node .graph-node-name')
    name?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '文档甲',
    { timeout: 10000 },
  )

  // 回到关系图
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(
      (element) => element.querySelector('.row-name')?.textContent === '关系图测试',
    )
    row?.click()
  })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '关系图测试',
    { timeout: 10000 },
  )
  await page.waitForFunction(() => document.querySelectorAll('.graph-node').length === 2)

  // 移除节点（连带移除关系）
  await page.evaluate(() => {
    document.querySelectorAll('.graph-node .graph-node-remove')[1]?.click()
  })
  await page.waitForFunction(() => document.querySelectorAll('.graph-node').length === 1)
  const edgeLeft = await page.$$eval('.graph-edge', (elements) => elements.length)
  assert.equal(edgeLeft, 0, '移除节点后关联箭头应一并删除')

  // 刷新后持久化
  await page.waitForFunction(
    () => document.querySelector('.save-state')?.textContent === '已保存',
    { timeout: 15000 },
  )
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => document.querySelector('.note-title')?.value === '关系图测试',
    { timeout: 20000 },
  )
  await page.waitForFunction(() => document.querySelectorAll('.graph-node').length === 1, {
    timeout: 20000,
  })

  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  const summary = await page.evaluate(() => ({
    nodes: document.querySelectorAll('.graph-node').length,
    edges: document.querySelectorAll('.graph-edge').length,
    relation: document.querySelector('.graph-node-relation')?.textContent?.trim() ?? '',
  }))

  console.log(JSON.stringify({ ...summary, consoleErrors: errors }, null, 2))
  console.log('文档关系图自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
