import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.APP_URL || 'http://localhost:5173'
const shotDir = path.resolve('.tmp-shots')
const downloadDir = path.resolve('.tmp-downloads')
fs.mkdirSync(shotDir, { recursive: true })
fs.mkdirSync(downloadDir, { recursive: true })
for (const file of fs.readdirSync(downloadDir)) fs.unlinkSync(path.join(downloadDir, file))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: path.resolve(`.tmp-chrome-codeblock-${Date.now()}`),
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

const client = await page.createCDPSession()
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })

async function waitForDownload(ext, timeout = 90000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const files = fs
      .readdirSync(downloadDir)
      .filter((file) => file.endsWith(ext) && !file.endsWith('.crdownload'))
    if (files.length > 0) {
      const target = path.join(downloadDir, files[0])
      if (fs.statSync(target).size > 0) return target
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`等待 ${ext} 下载超时`)
}

async function clickExport(label) {
  await page.waitForFunction(() => !document.querySelector('button[title="导出"]')?.disabled)
  await page.click('button[title="导出"]')
  await page.waitForSelector('.topbar-menu')
  const buttons = await page.$$('.topbar-menu button')
  for (const button of buttons) {
    const text = await button.evaluate((el) => el.textContent ?? '')
    if (text.includes(label)) {
      await button.click()
      return
    }
  }
  throw new Error(`未找到导出项：${label}`)
}

async function typeText(text) {
  for (const char of text) await page.keyboard.sendCharacter(char)
}

async function codeState() {
  return page.evaluate(() => {
    const block = document.querySelector('.note-code-block')
    if (!block) return null
    const code = block.querySelector('pre code')
    return {
      name: block.querySelector('.note-code-name')?.value ?? '',
      label: block.querySelector('.note-code-lang')?.textContent?.trim() ?? '',
      language: block.getAttribute('data-language'),
      preLanguage: block.querySelector('pre')?.getAttribute('data-language') ?? null,
      preLabel: block.querySelector('pre')?.getAttribute('data-language-label') ?? null,
      className: code?.className ?? '',
      text: code?.textContent ?? '',
      highlights: [
        ...new Set(
          [...block.querySelectorAll('code [class*="hljs-"]')].flatMap((el) =>
            [...el.classList].filter((name) => name.startsWith('hljs-')),
          ),
        ),
      ],
    }
  })
}

async function openLanguageMenu() {
  await page.click('.note-code-lang')
  await page.waitForSelector('.note-code-lang-menu')
  await page.waitForFunction(() =>
    document.querySelector('.note-code-lang-search input') === document.activeElement,
  )
}

async function chooseLanguage(query, expectedLabel) {
  await openLanguageMenu()
  await typeText(query)
  await page.waitForFunction(
    (label) => document.querySelector('.note-code-lang-item.selected span')?.textContent === label,
    {},
    expectedLabel,
  )
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.note-code-lang-menu'))
  await page.waitForFunction(
    (label) =>
      document.querySelector('.note-code-block .note-code-lang')?.textContent?.trim() === label,
    {},
    expectedLabel,
  )
}

await page.goto(URL, { waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')

// 新建测试笔记
const adds = await page.$$('.section-add')
await adds[0].click()
await page.waitForSelector('.popup-menu')
const menuButtons = await page.$$('.popup-menu button')
for (const button of menuButtons) {
  const text = await button.evaluate((el) => el.textContent ?? '')
  if (text.includes('文档')) {
    await button.click()
    break
  }
}
await page.waitForSelector('.dialog input')
await page.$eval('.dialog input', (input) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, '代码块测试')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForFunction(() => document.querySelector('.dialog input')?.value === '代码块测试')
await new Promise((resolve) => setTimeout(resolve, 150))
const dialogButtons = await page.$$('.dialog-actions button')
for (const button of dialogButtons) {
  const text = await button.evaluate((el) => el.textContent ?? '')
  if (text.includes('创建')) {
    await button.click()
    break
  }
}
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '代码块测试')
await page.waitForFunction(() => document.querySelectorAll('.note-prose p').length === 1)

// 斜杠菜单插入代码块
await page.click('.ProseMirror')
await page.keyboard.type('/daima')
await page.waitForFunction(
  () => document.querySelector('.slash-item .slash-title')?.textContent === '代码块',
)
await page.keyboard.press('Enter')
await page.waitForSelector('.note-prose .note-code-block')
await typeText('def answer():')
await page.keyboard.press('Enter')
await typeText('    return 42')

const initial = await codeState()
assert.equal(initial.label, 'Plain Text', '默认语言不是 Plain Text')
assert.equal(initial.language, 'plaintext', '默认包装器语言属性错误')
assert.equal(initial.className, '', '默认代码块不应带语言类')
assert.ok(initial.text.includes('def answer():'), '代码内容未输入')

// 代码块名称：输入不进入代码内容，Enter 后回到代码编辑
await page.click('.note-code-name')
await typeText('示例代码')
await page.waitForFunction(
  () => document.querySelector('.note-code-name')?.value === '示例代码',
)
const named = await codeState()
assert.equal(named.name, '示例代码', '名称未写入输入框')
assert.equal(named.text, initial.text, '输入名称时字符进入代码块')
await page.keyboard.press('Enter')
await page.waitForFunction(() =>
  document.activeElement?.classList.contains('ProseMirror'),
)

// 复制按钮：内容必须与代码完全一致，且不影响代码
await page.click('.note-code-copy')
await page.waitForFunction(
  () => document.querySelector('.note-code-copy')?.textContent?.trim() === '已复制',
)
const copiedText = await page.evaluate(() => window.__copiedText)
assert.equal(copiedText, initial.text, '复制内容与代码不一致')
assert.equal((await codeState()).text, initial.text, '复制后代码内容被改变')
await page.waitForFunction(
  () => document.querySelector('.note-code-copy')?.textContent?.trim() === '复制',
  { timeout: 4000 },
)

// 点击搜索框后，焦点必须留在输入框；输入不能进入代码块
await openLanguageMenu()
await page.click('.note-code-lang-search input')
await page.keyboard.type('py')
await page.waitForFunction(
  () => document.querySelector('.note-code-lang-search input')?.value === 'py',
)
const afterInputClick = await page.evaluate(() => ({
  inputFocused:
    document.activeElement === document.querySelector('.note-code-lang-search input'),
  codeText: document.querySelector('.note-code-block code')?.textContent ?? '',
}))
assert.ok(afterInputClick.inputFocused, '点击搜索框后焦点被抢回编辑器')
assert.equal(afterInputClick.codeText, initial.text, '搜索字符进入了代码块')
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.note-code-lang-menu'))

// 搜索短名 py 并选择 Python
await chooseLanguage('py', 'Python')
await page.waitForFunction(() =>
  document.querySelector('.note-code-block code .hljs-keyword'),
)
const python = await codeState()
assert.equal(python.language, 'python', '语言属性未写入 python')
assert.equal(python.preLanguage, 'python', 'pre 缺少 data-language')
assert.equal(python.preLabel, 'Python', 'pre 缺少语言显示名')
assert.equal(python.className, 'language-python', '代码元素缺少 language-python 类')
assert.ok(python.text.includes('def answer():'), '切换语言后代码内容丢失')
assert.ok(python.highlights.includes('hljs-keyword'), 'Python 代码没有关键字高亮')
assert.ok(python.highlights.includes('hljs-number'), 'Python 代码没有数字高亮')

// 搜索中文别名选择纯文本，纯文本不应出现高亮
await chooseLanguage('纯文本', 'Plain Text')
await page.waitForFunction(
  () => !document.querySelector('.note-code-block code [class*="hljs-"]'),
)
const plain = await codeState()
assert.equal(plain.className, '', '选回纯文本后仍残留语言类')
assert.equal(plain.highlights.length, 0, '纯文本不应有语法高亮')

// 搜索别名 golang 并选择 Go
await chooseLanguage('golang', 'Go')
const go = await codeState()
assert.equal(go.language, 'go', 'golang 别名未命中 Go')
assert.equal(go.className, 'language-go', 'Go 语言类错误')

// 重新选回 Python，验证持久化与导出
await chooseLanguage('python', 'Python')

// 记录语言面板深浅主题背景色
await openLanguageMenu()
const menuBgBefore = await page.$eval(
  '.note-code-lang-menu',
  (el) => getComputedStyle(el).backgroundColor,
)
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.note-code-lang-menu'))
const keywordColorBefore = await page.$eval(
  '.note-code-block code .hljs-keyword',
  (el) => getComputedStyle(el).color,
)
const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme)
await page.click('.theme-toggle')
await page.waitForFunction(
  (previous) => document.documentElement.dataset.theme !== previous,
  {},
  themeBefore,
)
await openLanguageMenu()
const menuBgAfter = await page.$eval(
  '.note-code-lang-menu',
  (el) => getComputedStyle(el).backgroundColor,
)
const keywordColorAfter = await page.$eval(
  '.note-code-block code .hljs-keyword',
  (el) => getComputedStyle(el).color,
)
assert.notEqual(menuBgBefore, menuBgAfter, '深浅主题下语言面板背景相同')
assert.notEqual(keywordColorBefore, keywordColorAfter, '深浅主题下代码高亮颜色相同')
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.note-code-lang-menu'))

// 保存后刷新，语言应保留
await page.waitForFunction(() =>
  document.querySelector('.save-state')?.textContent?.includes('已保存'),
)
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('.paper')
await page.waitForFunction(() => document.querySelector('.note-title')?.value === '代码块测试')
await page.waitForSelector('.note-prose .note-code-block')
await page.waitForFunction(() =>
  document.querySelector('.note-code-block code .hljs-keyword'),
)
const persisted = await codeState()
assert.equal(persisted.language, 'python', '刷新后语言丢失')
assert.equal(persisted.label, 'Python', '刷新后语言显示错误')
assert.equal(persisted.name, '示例代码', '刷新后代码块名称丢失')
assert.ok(persisted.text.includes('def answer():'), '刷新后代码内容丢失')
assert.ok(persisted.highlights.includes('hljs-keyword'), '刷新后高亮丢失')

// Markdown 导出带语言围栏
await clickExport('单文件')
const mdPath = await waitForDownload('.md')
const markdown = fs.readFileSync(mdPath, 'utf8')
assert.ok(markdown.includes('```python'), 'Markdown 代码围栏缺少 python')
assert.ok(markdown.includes('def answer():'), 'Markdown 缺少代码内容')
assert.ok(!markdown.includes('示例代码'), 'Markdown 不应包含代码块名称')

// PDF 能正常生成
await clickExport('直接下载')
const pdfPath = await waitForDownload('.pdf')
const pdfBuffer = fs.readFileSync(pdfPath)
assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF')
assert.ok(pdfBuffer.length > 5000, '代码块 PDF 文件过小')

// 只读渲染带语言属性与显示名；生产预览没有 /src 模块，跳过仅开发环境可用的直调
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
            type: 'codeBlock',
            attrs: { language: 'typescript', codeName: '导出名称' },
            content: [{ type: 'text', text: 'const n: number = 1' }],
          },
        ],
      })
    })
  : null
if (previewHtml !== null) {
  assert.ok(previewHtml.includes('data-language="typescript"'), '只读预览缺少 data-language')
  assert.ok(previewHtml.includes('language-typescript'), '只读预览缺少语言类')
  assert.ok(previewHtml.includes('data-language-label="TypeScript"'), '只读预览缺少语言显示名')
  assert.ok(previewHtml.includes('hljs-keyword'), '只读预览缺少语法高亮')
  assert.ok(!previewHtml.includes('导出名称'), '只读预览不应包含代码块名称')
}

// 导出 / 打印使用的静态 HTML 也应带高亮 span
const exportHighlight = devModulesAvailable
  ? await page.evaluate(async () => {
      const { highlightCodeInHtml } = await import('/src/lib/codeHighlight.ts')
      return highlightCodeInHtml(
        '<pre data-language="python"><code>def answer():\n    return 42</code></pre>',
      )
    })
  : null
if (exportHighlight !== null) {
  assert.ok(exportHighlight.includes('hljs-keyword'), '导出 HTML 缺少语法高亮')
  assert.ok(exportHighlight.includes('hljs-number'), '导出 HTML 缺少数字高亮')
}

await openLanguageMenu()
await typeText('py')
await page.screenshot({
  path: path.join(shotDir, 'codeblock-language-menu.png'),
  fullPage: false,
})
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.note-code-lang-menu'))

// 输入法组合输入不应重复字符
await page.click('.note-code-name')
await page.$eval('.note-code-name', (input) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, '')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
for (const char of ['a', 'b', 'c']) {
  await client.send('Input.imeSetComposition', {
    text: char,
    selectionStart: 1,
    selectionEnd: 1,
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  await client.send('Input.insertText', { text: char })
  await new Promise((resolve) => setTimeout(resolve, 100))
}
const imeName = await page.$eval('.note-code-name', (input) => input.value)
assert.equal(imeName, 'abc', '输入法组合输入导致名称字符重复')

await page.screenshot({ path: path.join(shotDir, 'codeblock-language.png'), fullPage: false })
await browser.close()

console.log(
  JSON.stringify(
    {
      initialLanguage: initial.language,
      name: named.name,
      imeName,
      copyMatches: copiedText === initial.text,
      python: { language: python.language, label: python.label, className: python.className },
      aliases: { plain: plain.label, go: go.language },
      persisted: { language: persisted.language, label: persisted.label },
      markdownBytes: Buffer.byteLength(markdown),
      pdfBytes: pdfBuffer.length,
      themeMenu: { before: menuBgBefore, after: menuBgAfter },
      consoleErrors: errors,
    },
    null,
    2,
  ),
)
if (errors.length) process.exit(1)
console.log('代码块语言自测全部通过')
