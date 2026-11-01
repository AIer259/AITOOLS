import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://localhost:5173'
const shotDir = path.resolve('.tmp-shots')
fs.mkdirSync(shotDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: path.resolve(`.tmp-chrome-stage3-${Date.now()}`),
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1400, height: 1000 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

await page.goto(URL, { waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')

// 新建空文档
const adds = await page.$$('.section-add')
await adds[0].click()
await page.waitForSelector('.popup-menu')
const menuButtons = await page.$$('.popup-menu button')
await menuButtons[0].click()
await page.waitForSelector('.dialog input')
const dialogButtons = await page.$$('.dialog-actions button')
await dialogButtons[1].click()
await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)
await page.waitForFunction(() => !document.querySelector('.slash-menu'))

await page.click('.note-prose')
await page.keyboard.type('/')
await page.waitForSelector('.slash-menu')
const initialCount = await page.$$eval('.slash-item', (els) => els.length)
assert.ok(initialCount >= 12, `菜单应有至少 12 项，实际 ${initialCount}`)

const layerRect = await page.$eval('.slash-menu-layer', (el) => el.getBoundingClientRect().toJSON())
assert.ok(layerRect.width > 0 && layerRect.left >= 0 && layerRect.right <= 1400)
await page.screenshot({ path: path.join(shotDir, 'stage3-menu.png') })

// /dai -> 代码块
await page.keyboard.type('dai')
await page.waitForFunction(() => document.querySelector('.slash-item .slash-title')?.textContent === '代码块')
const firstByDai = await page.$eval('.slash-item .slash-title', (el) => el.textContent)
await page.keyboard.press('ArrowDown')
const selectedAfterDown = await page.$eval('.slash-item.selected .slash-title', (el) => el.textContent)
assert.notEqual(selectedAfterDown, firstByDai)
await page.keyboard.press('ArrowUp')
await page.keyboard.press('Enter')
await page.waitForSelector('.note-prose pre')
await page.waitForFunction(() => !document.querySelector('.slash-menu'))
const textAfterCode = await page.$eval('.note-prose', (el) => el.textContent)
assert.ok(!textAfterCode.includes('/dai'))

// 撤销回空段落
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelectorAll('.note-prose pre').length === 0)

// /biaoge -> 复杂表格
await page.click('.note-prose')
await page.keyboard.type('/biaoge')
await page.waitForFunction(() => document.querySelector('.slash-item .slash-title')?.textContent === '复杂表格')
await page.keyboard.press('Enter')
await page.waitForSelector('.note-prose table')
await page.waitForFunction(() => !document.querySelector('.slash-menu'))

// 撤销表格
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelectorAll('.note-prose table').length === 0)

// 中文查询「代码」
await page.click('.note-prose')
await page.keyboard.type('/')
await page.keyboard.sendCharacter('代码')
await page.waitForFunction(() => document.querySelector('.slash-item .slash-title')?.textContent === '代码块')
const firstByChinese = await page.$eval('.slash-item .slash-title', (el) => el.textContent)
assert.equal(firstByChinese, '代码块')
await page.keyboard.press('Enter')
await page.waitForSelector('.note-prose pre')

// Esc 关闭
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelectorAll('.note-prose pre').length === 0)
await page.click('.note-prose')
await page.keyboard.type('/')
await page.waitForSelector('.slash-menu')
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.slash-menu'))

await page.screenshot({ path: path.join(shotDir, 'stage3-done.png') })
await browser.close()

const results = {
  initialCount,
  firstByDai,
  selectedAfterDown,
  firstByChinese,
  consoleErrors: errors,
}
console.log(JSON.stringify(results, null, 2))
if (errors.length) process.exit(1)
console.log('阶段三自测全部通过')
