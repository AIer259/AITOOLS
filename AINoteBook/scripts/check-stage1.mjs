import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://localhost:5173'
const shotDir = path.resolve('.tmp-shots')
const profileDir = path.resolve(`.tmp-chrome-stage1-${Date.now()}`)

fs.mkdirSync(shotDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profileDir,
  args: ['--no-first-run', '--disable-gpu', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
})

const page = await browser.newPage()
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

const results = {}
const shot = async (name) => page.screenshot({ path: path.join(shotDir, name) })

async function waitRows() {
  await page.waitForSelector('.paper', { timeout: 10000 })
}

async function rowHandle(name) {
  const handle = await page.evaluateHandle((rowName) => {
    return (
      [...document.querySelectorAll('.tree-row')].find(
        (el) => el.querySelector('.row-name')?.textContent === rowName,
      ) ?? null
    )
  }, name)
  const element = handle.asElement()
  if (!element) throw new Error(`未找到树节点：${name}`)
  return element
}

async function clickIn(selector, text) {
  const handles = await page.$$(selector)
  for (const handle of handles) {
    const label = await handle.evaluate((el) => el.textContent?.trim() ?? '')
    if (label.includes(text)) {
      await handle.click()
      return
    }
  }
  throw new Error(`未找到可点击项：${selector} / ${text}`)
}

async function fillDialog(value) {
  await page.$eval(
    '.dialog input',
    (input, next) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, next)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    value,
  )
}

async function createNodeFromSection(sectionIndex, kindLabel, name) {
  const sectionAdds = await page.$$('.section-add')
  await sectionAdds[sectionIndex].click()
  await page.waitForSelector('.popup-menu')
  await clickIn('.popup-menu button', kindLabel)
  await page.waitForSelector('.dialog input')
  await fillDialog(name)
  await clickIn('.dialog-actions button', '创建')
  await page.waitForFunction(
    (rowName) => [...document.querySelectorAll('.row-name')].some((el) => el.textContent === rowName),
    { timeout: 5000 },
    name,
  )
}

await page.goto(URL, { waitUntil: 'networkidle0' })
await waitRows()

// 1. 初始深色主题
results.themeInitial = await page.evaluate(() => document.documentElement.dataset.theme)
assert.equal(results.themeInitial, 'dark')
await shot('stage1-dark.png')

// 2. 折叠块开关
results.detailsBefore = await page.$eval('.note-details', (el) => el.classList.contains('is-open'))
await page.click('.note-details > button')
await page.waitForFunction(() =>
  document.querySelector('.note-details')?.classList.contains('is-open') === false,
)
results.detailsAfter = await page.$eval('.note-details', (el) => el.classList.contains('is-open'))
assert.notEqual(results.detailsBefore, results.detailsAfter)
await page.click('.note-details > button')

// 3. 表格渲染
results.tables = await page.$$eval('.note-prose table', (els) => els.length)
assert.ok(results.tables > 0, '示例笔记应包含表格')

// 4. 主题切换与持久化
await page.click('.theme-toggle')
await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
results.themeAfterToggle = await page.evaluate(() => document.documentElement.dataset.theme)
await shot('stage1-light.png')

await page.reload({ waitUntil: 'networkidle0' })
await waitRows()
results.themeAfterReload = await page.evaluate(() => document.documentElement.dataset.theme)
assert.equal(results.themeAfterReload, 'light')
await page.click('.theme-toggle')
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')

// 5. 新建文件夹（空间）
await createNodeFromSection(0, '新建文件夹', '测试文件夹')

// 6. 在文件夹内新建文档
const folderRow = await rowHandle('测试文件夹')
const addButton = await folderRow.$('.row-action[title="新建"]')
await addButton.click()
await page.waitForSelector('.popup-menu')
await clickIn('.popup-menu button', '新建文档')
await page.waitForSelector('.dialog input')
await fillDialog('测试文档')
await clickIn('.dialog-actions button', '创建')
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '测试文档')
await page.waitForSelector('.note-prose')

// 7. 编辑正文与 Markdown 标题快捷输入
await page.click('.note-prose')
await page.keyboard.sendCharacter('第一段测试内容')
await page.keyboard.press('Enter')
await page.keyboard.type('# ')
await page.keyboard.sendCharacter('快速标题')
await page.waitForFunction(() => [...document.querySelectorAll('.note-prose h1')].some((el) => el.textContent === '快速标题'))
results.h1Created = true

// 8. 重命名文档
const activeRow = await page.$('.tree-row.active')
const moreButton = await activeRow.$('.row-action[title="更多"]')
await moreButton.click()
await page.waitForSelector('.popup-menu')
await clickIn('.popup-menu button', '重命名')
await page.waitForSelector('.dialog input')
await fillDialog('重命名后的文档')
await clickIn('.dialog-actions button', '保存')
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '重命名后的文档')
results.renamed = true
await shot('stage1-created.png')

// 9. 删除文件夹（连同内部文档）
const folderRowAgain = await rowHandle('测试文件夹')
const folderMore = await folderRowAgain.$('.row-action[title="更多"]')
await folderMore.click()
await page.waitForSelector('.popup-menu')
await clickIn('.popup-menu button', '移到回收站')
await page.waitForSelector('.dialog-message')
await clickIn('.dialog-actions button', '移到回收站')
await page.waitForFunction(
  () =>
    ![...document.querySelectorAll('.row-name')].some(
      (el) => el.textContent === '测试文件夹' || el.textContent === '重命名后的文档',
    ),
)
results.folderDeleted = true

// 10. 新建根文档 -> 输入内容 -> 刷新验证持久化
await createNodeFromSection(1, '新建文档', '持久化测试')
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '持久化测试')
await page.waitForSelector('.note-prose')
await page.click('.note-prose')
await page.keyboard.sendCharacter('刷新后应保留这段内容')
await new Promise((resolve) => setTimeout(resolve, 900))
await page.reload({ waitUntil: 'networkidle0' })
await waitRows()
await page.waitForSelector('.note-prose')
results.persistedTitle = await page.$eval('.note-title', (el) => el.value)
results.persistedBody = await page.$eval('.note-prose', (el) => el.textContent)
assert.equal(results.persistedTitle, '持久化测试')
assert.ok(results.persistedBody.includes('刷新后应保留这段内容'))

results.consoleErrors = errors
await shot('stage1-persisted.png')

await browser.close()

console.log(JSON.stringify(results, null, 2))
if (errors.length > 0) {
  console.error('存在浏览器控制台错误')
  process.exit(1)
}
console.log('阶段一自测全部通过')
