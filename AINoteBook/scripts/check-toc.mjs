import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.APP_URL || 'http://localhost:5173'
const shotDir = path.resolve('.tmp-shots')
fs.mkdirSync(shotDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: path.resolve(`.tmp-chrome-toc-${Date.now()}`),
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1500, height: 1000 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

async function typeText(text) {
  for (const char of text) await page.keyboard.sendCharacter(char)
}

async function setInput(selector, value) {
  await page.$eval(
    selector,
    (input, next) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, next)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    value,
  )
}

async function tocTexts() {
  return page.$$eval('.toc-item', (items) => items.map((item) => item.textContent?.trim()))
}

async function clickTocToggle(label) {
  await page.evaluate((text) => {
    const row = [...document.querySelectorAll('.toc-row')].find(
      (item) => item.querySelector('.toc-item')?.textContent?.trim() === text,
    )
    row?.querySelector('.toc-toggle')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, label)
}

async function clickTocItem(label) {
  await page.evaluate((text) => {
    const item = [...document.querySelectorAll('.toc-item')].find(
      (entry) => entry.textContent?.trim() === text,
    )
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, label)
}

await page.goto(URL, { waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')

const adds = await page.$$('.section-add')
await adds[0].click()
await page.waitForSelector('.popup-menu')
for (const button of await page.$$('.popup-menu button')) {
  const text = await button.evaluate((el) => el.textContent ?? '')
  if (text.includes('文档')) {
    await button.click()
    break
  }
}
await page.waitForSelector('.dialog input')
await setInput('.dialog input', '目录折叠测试')
await page.waitForFunction(() => document.querySelector('.dialog input')?.value === '目录折叠测试')
await new Promise((resolve) => setTimeout(resolve, 150))
for (const button of await page.$$('.dialog-actions button')) {
  const text = await button.evaluate((el) => el.textContent ?? '')
  if (text.includes('创建')) {
    await button.click()
    break
  }
}
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '目录折叠测试')
await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)

// 生成层级标题
await page.click('.ProseMirror')
await page.keyboard.type('# ')
await typeText('一级A')
await page.keyboard.press('Enter')
await page.keyboard.type('## ')
await typeText('二级A1')
await page.keyboard.press('Enter')
await page.keyboard.type('### ')
await typeText('三级A1a')
await page.keyboard.press('Enter')
await page.keyboard.type('## ')
await typeText('二级A2')
await page.keyboard.press('Enter')
await page.keyboard.type('# ')
await typeText('一级B')
await page.keyboard.press('Enter')
await page.keyboard.type('## ')
await typeText('二级B1')
await page.waitForSelector('.note-prose h1')
await page.waitForSelector('.note-prose h2')
await page.waitForSelector('.note-prose h3')

await page.waitForFunction(() => !document.querySelector('button[title="展开目录"]')?.disabled)
await page.click('button[title="展开目录"]')
await page.waitForSelector('.toc-panel')
await page.waitForFunction(() => document.querySelectorAll('.toc-item').length === 5)

const allItems = await tocTexts()
assert.deepEqual(allItems, ['一级A', '二级A1', '二级A2', '一级B', '二级B1'])

const toggleCount = await page.$$eval('.toc-toggle', (buttons) => buttons.length)
assert.equal(toggleCount, 3, '有下级的标题应显示三个折叠按钮')

await page.screenshot({ path: path.join(shotDir, 'toc-expanded.png'), fullPage: false })

// 折叠一级A：隐藏其所有下级
await clickTocToggle('一级A')
await page.waitForFunction(
  (expected) => {
    const texts = [...document.querySelectorAll('.toc-item')].map((item) =>
      item.textContent?.trim(),
    )
    return JSON.stringify(texts) === JSON.stringify(expected)
  },
  {},
  ['一级A', '一级B', '二级B1'],
)
const collapsedA = await page.$$eval('.toc-row', (rows) => {
  const row = rows.find((item) => item.querySelector('.toc-item')?.textContent?.trim() === '一级A')
  const toggle = row?.querySelector('.toc-toggle')
  return {
    expanded: toggle?.getAttribute('aria-expanded'),
    collapsedClass: toggle?.classList.contains('is-collapsed'),
  }
})
assert.equal(collapsedA.expanded, 'false')
assert.equal(collapsedA.collapsedClass, true)

// 展开一级A；二级A1 默认折叠，三级标题仍隐藏
await clickTocToggle('一级A')
await page.waitForFunction(
  (expected) => {
    const texts = [...document.querySelectorAll('.toc-item')].map((item) =>
      item.textContent?.trim(),
    )
    return JSON.stringify(texts) === JSON.stringify(expected)
  },
  {},
  ['一级A', '二级A1', '二级A2', '一级B', '二级B1'],
)

// 展开二级A1 显示三级标题，再折叠隐藏
await clickTocToggle('二级A1')
await page.waitForFunction(() => document.querySelectorAll('.toc-item').length === 6)
await clickTocToggle('二级A1')
await page.waitForFunction(
  (expected) => {
    const texts = [...document.querySelectorAll('.toc-item')].map((item) =>
      item.textContent?.trim(),
    )
    return JSON.stringify(texts) === JSON.stringify(expected)
  },
  {},
  ['一级A', '二级A1', '二级A2', '一级B', '二级B1'],
)

// 点击标题文字仍可跳转
await clickTocItem('二级A2')
await page.waitForFunction(
  () => document.querySelector('.toc-item.active')?.textContent?.trim() === '二级A2',
)
await page.screenshot({ path: path.join(shotDir, 'toc-collapsed.png'), fullPage: false })
const finalItems = await tocTexts()

await browser.close()

console.log(
  JSON.stringify(
    {
      allItems,
      toggleCount,
      collapsedA,
      finalItems,
      consoleErrors: errors,
    },
    null,
    2,
  ),
)
if (errors.length) process.exit(1)
console.log('目录折叠自测全部通过')
