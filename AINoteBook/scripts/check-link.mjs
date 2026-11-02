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
  userDataDir: path.resolve(`.tmp-chrome-link-${Date.now()}`),
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1500, height: 1000 },
})

const page = await browser.newPage()
await page.evaluateOnNewDocument(() => {
  window.__copiedText = null
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        window.__copiedText = text
      },
    },
  })
})

const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

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

async function linkState() {
  return page.evaluate(() => {
    const link = document.querySelector('.note-prose a')
    return {
      text: link?.textContent ?? null,
      href: link?.getAttribute('href') ?? null,
      count: document.querySelectorAll('.note-prose a').length,
      bodyText: document.querySelector('.note-prose')?.textContent ?? '',
    }
  })
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
await setInput('.dialog input', '链接测试')
await page.waitForFunction(() => document.querySelector('.dialog input')?.value === '链接测试')
await new Promise((resolve) => setTimeout(resolve, 150))
for (const button of await page.$$('.dialog-actions button')) {
  const text = await button.evaluate((el) => el.textContent ?? '')
  if (text.includes('创建')) {
    await button.click()
    break
  }
}
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '链接测试')
await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)

// 输入网址，触发自动链接
await page.click('.ProseMirror')
await page.keyboard.type('https://example.com')
await page.keyboard.press('Space')
await page.waitForSelector('.note-prose a[href="https://example.com"]')

// 悬停显示卡片
await page.hover('.note-prose a')
await page.waitForSelector('.link-hover-card')
const hoverCard = await page.evaluate(() => ({
  url: document.querySelector('.link-hover-url')?.textContent?.trim(),
  actions: [...document.querySelectorAll('.link-hover-action')].map((button) =>
    button.getAttribute('aria-label'),
  ),
}))
assert.equal(hoverCard.url, 'https://example.com', '悬停卡片 URL 不正确')
assert.deepEqual(hoverCard.actions, ['复制链接', '修改链接'], '悬停卡片按钮不完整')
await page.screenshot({ path: path.join(shotDir, 'link-hover.png'), fullPage: false })

// 复制链接
await page.click('.link-hover-action[aria-label="复制链接"]')
await page.waitForFunction(() => window.__copiedText === 'https://example.com')
await page.waitForFunction(() => document.querySelector('.link-hover-action.is-copied'))

// 打开编辑弹窗
await page.click('.link-hover-action[aria-label="修改链接"]')
await page.waitForSelector('.link-dialog')
const dialogValues = await page.$$eval('.link-dialog input', (inputs) =>
  inputs.map((input) => input.value),
)
assert.equal(dialogValues[0], 'https://example.com', 'URL 输入框初始值错误')
assert.equal(dialogValues[1], 'https://example.com', '标题输入框初始值错误')
const deleteLabel = await page.$eval('.link-delete', (button) => button.textContent?.trim())
assert.ok(deleteLabel?.includes('删除链接'), '缺少删除链接按钮')
await page.screenshot({ path: path.join(shotDir, 'link-dialog.png'), fullPage: false })

// 修改 URL 与标题
await setInput('.link-field:first-of-type input', 'https://example.org/page?x=1')
await setInput('.link-field:last-of-type input', '示例链接')
await page.click('.link-dialog .btn.primary')
await page.waitForFunction(() => !document.querySelector('.link-dialog'))
const edited = await linkState()
assert.equal(edited.count, 1, '修改后链接数量异常')
assert.equal(edited.text, '示例链接', '链接标题未更新')
assert.equal(edited.href, 'https://example.org/page?x=1', '链接地址未更新')
assert.ok(edited.bodyText.includes('示例链接'), '链接文字丢失')

// 取消修改不生效
await page.hover('.note-prose a')
await page.waitForSelector('.link-hover-card')
await page.click('.link-hover-action[aria-label="修改链接"]')
await page.waitForSelector('.link-dialog')
await setInput('.link-field:first-of-type input', 'https://example.net/cancel')
await page.click('.link-dialog .btn.ghost')
await page.waitForFunction(() => !document.querySelector('.link-dialog'))
assert.equal((await linkState()).href, 'https://example.org/page?x=1', '取消后链接被修改')

// 删除链接，文字保留
await page.hover('.note-prose a')
await page.waitForSelector('.link-hover-card')
await page.click('.link-hover-action[aria-label="修改链接"]')
await page.waitForSelector('.link-dialog')
await page.click('.link-delete')
await page.waitForFunction(() => !document.querySelector('.link-dialog'))
const removed = await linkState()
assert.equal(removed.count, 0, '删除链接后仍有链接')
assert.ok(removed.bodyText.includes('示例链接'), '删除链接后文字丢失')

await page.screenshot({ path: path.join(shotDir, 'link-removed.png'), fullPage: false })
await browser.close()

console.log(
  JSON.stringify(
    {
      hoverCard,
      edited,
      removed,
      copiedText: 'https://example.com',
      consoleErrors: errors,
    },
    null,
    2,
  ),
)
if (errors.length) process.exit(1)
console.log('链接悬停与编辑自测全部通过')
