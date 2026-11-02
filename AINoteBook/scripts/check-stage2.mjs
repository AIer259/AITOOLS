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
  userDataDir: path.resolve(`.tmp-chrome-stage2-${Date.now()}`),
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

// 新建一篇空文档
const sectionAdds = await page.$$('.section-add')
await sectionAdds[0].click()
await page.waitForSelector('.popup-menu')
const menuButtons = await page.$$('.popup-menu button')
await menuButtons[0].click()
await page.waitForSelector('.dialog input')
await page.$eval('.dialog input', (input) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, 'Markdown 快捷输入自测')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const dialogButtons = await page.$$('.dialog-actions button')
await dialogButtons[1].click()
await page.waitForFunction(() => document.querySelector('.note-title')?.value === 'Markdown 快捷输入自测')
await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)

await page.click('.note-prose')
await page.keyboard.type('- ')
await page.keyboard.sendCharacter('项目一')
await page.keyboard.press('Enter')
await page.keyboard.press('Enter')
await page.keyboard.type('1. ')
await page.keyboard.sendCharacter('第一项')
await page.keyboard.press('Enter')
await page.keyboard.press('Enter')
await page.keyboard.type('> ')
await page.keyboard.sendCharacter('引用内容')
await page.keyboard.press('Enter')
await page.keyboard.press('Enter')
await page.keyboard.type('[ ] ')
await page.keyboard.sendCharacter('待办事项')
await page.keyboard.press('Enter')
await page.keyboard.press('Enter')
await page.keyboard.type('```')
await page.keyboard.type(' ')
await page.keyboard.sendCharacter('const a = 1')

await page.waitForFunction(() => document.querySelectorAll('.note-prose pre code').length > 0)

const result = await page.evaluate(() => ({
  bullet: [...document.querySelectorAll('.note-prose ul:not([data-type="taskList"]) li')].some(
    (el) => el.textContent?.includes('项目一'),
  ),
  ordered: [...document.querySelectorAll('.note-prose ol li')].some((el) =>
    el.textContent?.includes('第一项'),
  ),
  quote: [...document.querySelectorAll('.note-prose blockquote')].some((el) =>
    el.textContent?.includes('引用内容'),
  ),
  task: [...document.querySelectorAll('.note-prose ul[data-type="taskList"] li')].some((el) =>
    el.textContent?.includes('待办事项'),
  ),
  code: [...document.querySelectorAll('.note-prose pre code')].some((el) =>
    el.textContent?.includes('const a = 1'),
  ),
}))

assert.ok(result.bullet, '无序列表未生成')
assert.ok(result.ordered, '有序列表未生成')
assert.ok(result.quote, '引用未生成')
assert.ok(result.task, '待办列表未生成')
assert.ok(result.code, '代码块未生成')

// 自动链接：settings.py 这类文件名保持纯文本，明确写出的网址仍自动识别
await page.click('.note-add-space')
await page.keyboard.type('settings.py')
await page.keyboard.press('Enter')
await page.keyboard.type('https://example.com ')
await page.waitForFunction(() =>
  [...document.querySelectorAll('.note-prose a')].some(
    (link) => link.textContent === 'https://example.com',
  ),
)
const autoLink = await page.evaluate(() => ({
  filenamePlain: [...document.querySelectorAll('.note-prose p')].some(
    (paragraph) => paragraph.textContent?.trim() === 'settings.py' && !paragraph.querySelector('a'),
  ),
  urlLinked: [...document.querySelectorAll('.note-prose a')].some(
    (link) => link.textContent === 'https://example.com',
  ),
  links: [...document.querySelectorAll('.note-prose a')].map((link) => ({
    text: link.textContent,
    href: link.getAttribute('href'),
  })),
}))
assert.ok(autoLink.filenamePlain, 'settings.py 被错误识别为超链接')
assert.ok(autoLink.urlLinked, '明确写出的网址没有自动识别')
result.autoLink = autoLink

await page.screenshot({ path: path.join(shotDir, 'stage2-markdown.png'), fullPage: false })
await browser.close()

console.log(JSON.stringify({ ...result, consoleErrors: errors }, null, 2))
if (errors.length) process.exit(1)
console.log('阶段二自测全部通过')
