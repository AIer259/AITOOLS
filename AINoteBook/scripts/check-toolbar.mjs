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
  userDataDir: path.resolve(`.tmp-chrome-toolbar-${Date.now()}`),
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
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    value,
  )
}

async function waitForToolbar() {
  await page.waitForFunction(() => {
    const toolbar = document.querySelector('.selection-toolbar')
    if (!toolbar) return false
    const rect = toolbar.getBoundingClientRect()
    return rect.height > 0 && getComputedStyle(toolbar).visibility !== 'hidden'
  })
}

async function clickToolbar(label) {
  await page.$eval(
    `.selection-toolbar-button[aria-label="${label}"]`,
    (button) => button.click(),
  )
}

async function selectParagraph() {
  await page.click('.note-prose p')
  await page.keyboard.press('End')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Home')
  await page.keyboard.up('Shift')
  await waitForToolbar()
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
await setInput('.dialog input', '格式工具条测试')
await page.waitForFunction(() => document.querySelector('.dialog input')?.value === '格式工具条测试')
await new Promise((resolve) => setTimeout(resolve, 150))
for (const button of await page.$$('.dialog-actions button')) {
  const text = await button.evaluate((el) => el.textContent ?? '')
  if (text.includes('创建')) {
    await button.click()
    break
  }
}
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '格式工具条测试')
await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)

await page.click('.ProseMirror')
await typeText('格式测试文本')
await selectParagraph()

const actions = await page.$$eval('.selection-toolbar-button', (buttons) =>
  buttons.map((button) => button.getAttribute('aria-label')),
)
assert.deepEqual(actions, ['加粗', '斜体', '下划线', '链接', '着色'], '工具条按钮不完整')
await page.screenshot({ path: path.join(shotDir, 'selection-toolbar.png'), fullPage: false })

// 加粗、斜体、下划线
await clickToolbar('加粗')
await page.waitForFunction(() => Boolean(document.querySelector('.note-prose strong')))
await clickToolbar('斜体')
await page.waitForFunction(() => Boolean(document.querySelector('.note-prose em')))
await clickToolbar('下划线')
await page.waitForFunction(() => Boolean(document.querySelector('.note-prose u')))

// 文字颜色与背景色
await clickToolbar('着色')
await page.waitForSelector('.selection-color-panel')
const sections = await page.$$eval('.color-section-title', (els) =>
  els.map((el) => el.textContent?.trim()),
)
assert.deepEqual(sections, ['Text Color', 'Background Color'], '颜色分组标题错误')
assert.equal(
  await page.$$eval('.color-custom input', (inputs) => inputs.length),
  2,
  '自定义颜色选择器数量错误',
)
await page.screenshot({ path: path.join(shotDir, 'selection-colors.png'), fullPage: false })

await page.click('.color-swatch[aria-label="文字颜色：红色"]')
await page.waitForFunction(() => {
  const spans = [...document.querySelectorAll('.note-prose span')]
  return spans.some((el) => getComputedStyle(el).color === 'rgb(229, 72, 77)')
})

await clickToolbar('着色')
await page.waitForSelector('.selection-color-panel')
await page.click('.color-swatch[aria-label="背景颜色：灰色"]')
await page.waitForFunction(() => {
  const spans = [...document.querySelectorAll('.note-prose span')]
  return spans.some(
    (el) => getComputedStyle(el).backgroundColor === 'rgba(120, 119, 116, 0.28)',
  )
})

// 自定义文字颜色与背景色
await clickToolbar('着色')
await page.waitForSelector('.selection-color-panel')
await setInput('.color-section:first-of-type .color-custom input', '#123456')
await page.waitForFunction(() => {
  const spans = [...document.querySelectorAll('.note-prose span')]
  return spans.some((el) => getComputedStyle(el).color === 'rgb(18, 52, 86)')
})
await setInput('.color-section:last-of-type .color-custom input', '#abcdef')
await page.waitForFunction(() => {
  const spans = [...document.querySelectorAll('.note-prose span')]
  return spans.some((el) => getComputedStyle(el).backgroundColor === 'rgb(171, 205, 239)')
})
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.selection-color-panel'))

// 刷新后格式与颜色仍保留
await page.waitForFunction(() =>
  document.querySelector('.save-state')?.textContent?.includes('已保存'),
)
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForFunction(
  () => document.querySelector('.note-title')?.value === '格式工具条测试',
)
const persisted = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.note-prose span')]
  return {
    bold: Boolean(document.querySelector('.note-prose strong')),
    italic: Boolean(document.querySelector('.note-prose em')),
    underline: Boolean(document.querySelector('.note-prose u')),
    color: spans.some((el) => getComputedStyle(el).color === 'rgb(18, 52, 86)'),
    background: spans.some(
      (el) => getComputedStyle(el).backgroundColor === 'rgb(171, 205, 239)',
    ),
  }
})
assert.ok(persisted.bold, '刷新后加粗丢失')
assert.ok(persisted.italic, '刷新后斜体丢失')
assert.ok(persisted.underline, '刷新后下划线丢失')
assert.ok(persisted.color, '刷新后文字颜色丢失')
assert.ok(persisted.background, '刷新后背景色丢失')

// 选择同一段落内的文字添加链接
await selectParagraph()
await clickToolbar('链接')
await page.waitForSelector('.link-dialog')
assert.equal(
  await page.$$eval('.link-delete', (buttons) => buttons.length),
  0,
  '新建链接不应显示删除按钮',
)
await setInput('.link-field:first-of-type input', 'https://example.com')
await page.screenshot({ path: path.join(shotDir, 'selection-link.png'), fullPage: false })
await page.click('.link-dialog .btn.primary')
await page.waitForFunction(() => !document.querySelector('.link-dialog'))
const linked = await page.evaluate(() => ({
  href: document.querySelector('.note-prose a')?.getAttribute('href') ?? null,
  text: document.querySelector('.note-prose a')?.textContent ?? null,
}))
assert.equal(linked.href, 'https://example.com', '选区链接地址错误')
assert.ok(linked.text?.includes('格式测试文本'), '选区链接文字错误')

// 再次打开链接弹窗，删除链接但保留文字
await selectParagraph()
await clickToolbar('链接')
await page.waitForSelector('.link-dialog')
assert.equal(
  await page.$$eval('.link-delete', (buttons) => buttons.length),
  1,
  '已有链接应显示删除按钮',
)
await page.click('.link-delete')
await page.waitForFunction(() => !document.querySelector('.link-dialog'))
const removed = await page.evaluate(() => ({
  links: document.querySelectorAll('.note-prose a').length,
  text: document.querySelector('.note-prose')?.textContent ?? '',
}))
assert.equal(removed.links, 0, '删除后仍有链接')
assert.ok(removed.text.includes('格式测试文本'), '删除后文字丢失')

// 只读渲染保留文字颜色与背景色；生产预览没有 /src 模块，跳过仅开发环境可用的直调
const devModulesAvailable = await page.evaluate(() =>
  Boolean(document.querySelector('script[src^="/src/"]')),
)
const previewHtml = devModulesAvailable
  ? await page.evaluate(async () => {
      const { docJsonToHtml } = await import('/src/lib/renderDoc.ts')
      return docJsonToHtml({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '彩色文字',
                marks: [
                  {
                    type: 'textStyle',
                    attrs: { color: '#e5484d', backgroundColor: 'rgba(120, 119, 116, 0.28)' },
                  },
                ],
              },
            ],
          },
        ],
      })
    })
  : null
if (previewHtml !== null) {
  assert.ok(previewHtml.includes('color'), '只读预览缺少文字颜色')
  assert.ok(previewHtml.includes('background-color'), '只读预览缺少背景色')
}

await page.screenshot({ path: path.join(shotDir, 'selection-toolbar-final.png'), fullPage: false })
await browser.close()

console.log(
  JSON.stringify(
    {
      actions,
      sections,
      persisted,
      linked,
      removed,
      previewRendered: previewHtml !== null,
      consoleErrors: errors,
    },
    null,
    2,
  ),
)
if (errors.length) process.exit(1)
console.log('选区格式工具条自测全部通过')
