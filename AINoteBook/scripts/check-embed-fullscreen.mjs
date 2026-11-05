import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5174'
const mdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-embed-fs-'))
const mdPath = path.join(mdDir, 'fullscreen-sample.md')
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-chrome-embed-fs-'))

fs.writeFileSync(
  mdPath,
  [
    '# 全屏嵌入样例',
    '',
    '这是一段用于验证全屏的正文内容。',
    '',
    '- 列表甲',
    '- 列表乙',
    '',
  ].join('\n'),
)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir,
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1500, height: 1100 },
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
  await page.$eval('.dialog input', (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, name)
  const dialogButtons = await page.$$('.dialog-actions button')
  await dialogButtons[1].click()
  await page.waitForFunction((expected) => document.querySelector('.note-title')?.value === expected, {}, name)
  await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)
}

async function openEmbedPicker() {
  const clicked = await page.evaluateHandle(() => {
    const root = document.querySelector('.note-prose')
    if (!root) return null
    const paragraphs = [...root.querySelectorAll(':scope > p')]
    return paragraphs[paragraphs.length - 1] ?? root
  })
  const element = clicked.asElement()
  assert.ok(element, '找不到末尾段落')
  await element.click()
  await page.keyboard.type('/embed')
  await page.waitForFunction(
    () => document.querySelector('.slash-item .slash-title')?.textContent === '嵌入文档',
  )
  await page.keyboard.press('Enter')
  await page.waitForSelector('.embed-picker')
}

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.paper')

  await createNote('嵌入全屏测试')
  await openEmbedPicker()

  const fileInput = await page.$('.embed-picker input[type="file"]')
  assert.ok(fileInput, '嵌入弹窗缺少文件输入')
  await fileInput.uploadFile(mdPath)
  await page.waitForFunction(() => !document.querySelector('.embed-picker'), { timeout: 20000 })
  await page.waitForFunction(() => document.querySelectorAll('.embed-node').length === 1, {
    timeout: 20000,
  })

  // 进入全屏
  await page.click('.embed-node .embed-zoom')
  await page.waitForSelector('.embed-fullscreen', { timeout: 10000 })

  const layout = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect()
    const fullscreen = document.querySelector('.embed-fullscreen')?.getBoundingClientRect()
    const md = document.querySelector('.embed-fullscreen .embed-md')
    return {
      topbarTop: topbar?.top ?? null,
      topbarHeight: topbar?.height ?? null,
      fsTop: fullscreen?.top ?? null,
      fsHeight: fullscreen?.height ?? null,
      name: document.querySelector('.embed-fullscreen-head .embed-name')?.textContent ?? '',
      badge: document.querySelector('.embed-fullscreen-head .embed-badge')?.textContent ?? '',
      closeVisible: Boolean(document.querySelector('.embed-fullscreen-close')),
      mdHeading: md?.querySelector('h1')?.textContent ?? '',
      mdText: md?.textContent ?? '',
      embedBodyVisible: Boolean(document.querySelector('.embed-node .embed-body')),
    }
  })

  assert.equal(layout.topbarTop, 0, '顶栏未保持在顶部')
  assert.ok(layout.topbarHeight > 0, '顶栏缺失')
  assert.ok(
    Math.abs(layout.fsTop - layout.topbarHeight) < 1,
    `全屏浮层未从顶栏下方开始：top=${layout.fsTop} topbarHeight=${layout.topbarHeight}`,
  )
  assert.equal(layout.name, 'fullscreen-sample', `全屏标题不对：${layout.name}`)
  assert.equal(layout.badge, 'Markdown', `全屏类型不对：${layout.badge}`)
  assert.ok(layout.closeVisible, '全屏缺少关闭按钮')
  assert.equal(layout.mdHeading, '全屏嵌入样例', '全屏 Markdown 标题未渲染')
  assert.ok(layout.mdText.includes('全屏'), '全屏 Markdown 正文未渲染')
  assert.equal(layout.embedBodyVisible, false, '全屏时主卡片正文应隐藏')

  const viewport = page.viewport()
  const expectedHeight = viewport.height - layout.topbarHeight
  assert.ok(
    Math.abs(layout.fsHeight - expectedHeight) < 2,
    `全屏浮层未占满剩余视口：height=${layout.fsHeight} expected=${expectedHeight}`,
  )

  // 关闭按钮返回主文档
  await page.click('.embed-fullscreen-close')
  await page.waitForFunction(() => !document.querySelector('.embed-fullscreen'), { timeout: 5000 })
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('.embed-node').length),
    1,
    '关闭全屏后嵌入卡片丢失',
  )

  // Esc 关闭
  await page.click('.embed-node .embed-zoom')
  await page.waitForSelector('.embed-fullscreen', { timeout: 5000 })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.embed-fullscreen'), { timeout: 5000 })

  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)

  console.log(
    JSON.stringify(
      {
        fullscreen: {
          name: layout.name,
          badge: layout.badge,
          top: layout.fsTop,
          height: layout.fsHeight,
          mdHeading: layout.mdHeading,
        },
        closeButton: true,
        escClose: true,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log('嵌入文档全屏自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(mdDir, { recursive: true, force: true })
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
