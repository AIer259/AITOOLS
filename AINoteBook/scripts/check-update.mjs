import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:4173/'
const pkg = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const CURRENT = pkg.version
const LATEST = '9.9.9'

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-update-'))
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir,
  args: ['--no-first-run', '--disable-gpu'],
  defaultViewport: { width: 1400, height: 900 },
})

function isAppError(text) {
  return !text.includes('Failed to load resource')
}

async function openPage(versionResponse) {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (request.url().includes('/version.json')) {
      if (versionResponse.status) {
        void request.respond({
          status: versionResponse.status,
          contentType: 'application/json',
          body: '{}',
        })
      } else {
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ version: versionResponse.version }),
        })
      }
      return
    }
    void request.continue()
  })

  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.topbar')
  return { page, errors }
}

async function clickDialogButton(page, label) {
  await page.evaluate((text) => {
    const button = [...document.querySelectorAll('.update-dialog button')].find(
      (item) => item.textContent?.trim() === text,
    )
    button?.click()
  }, label)
}

try {
  // 1. 新版本：弹窗、稍后、同一会话不再提示
  const newer = await openPage({ version: LATEST })
  await newer.page.waitForSelector('.update-dialog', { timeout: 5000 })
  const dialogText = await newer.page.$eval('.update-dialog', (element) => element.textContent)
  assert.ok(dialogText.includes(CURRENT), '弹窗未显示当前版本')
  assert.ok(dialogText.includes(LATEST), '弹窗未显示最新版本')

  await clickDialogButton(newer.page, '稍后')
  await newer.page.waitForFunction(() => !document.querySelector('.update-dialog'))
  await newer.page.reload({ waitUntil: 'networkidle0' })
  await newer.page.waitForSelector('.topbar')
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(await newer.page.$('.update-dialog'), null, '稍后后重新加载不应再提示')
  assert.deepEqual(newer.errors.filter(isAppError), [], `控制台错误：${newer.errors.join(' | ')}`)
  await newer.page.close()

  // 2. 新版本：立即更新会带上 v 参数并清理
  const updating = await openPage({ version: LATEST })
  await updating.page.waitForSelector('.update-dialog', { timeout: 5000 })
  const navigated = new Promise((resolve) => {
    const handler = (frame) => {
      if (frame !== updating.page.mainFrame()) return
      updating.page.off('framenavigated', handler)
      resolve(frame.url())
    }
    updating.page.on('framenavigated', handler)
  })
  await clickDialogButton(updating.page, '立即更新').catch(() => {})
  const navigatedUrl = await Promise.race([
    navigated,
    new Promise((_, reject) => setTimeout(() => reject(new Error('未触发页面刷新')), 5000)),
  ])
  assert.ok(navigatedUrl.includes(`v=${LATEST}`), `刷新地址缺少版本参数：${navigatedUrl}`)
  await updating.page.waitForSelector('.topbar')
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.ok(!updating.page.url().includes('v='), '加载后应清理版本参数')
  assert.deepEqual(
    updating.errors.filter(isAppError),
    [],
    `控制台错误：${updating.errors.join(' | ')}`,
  )
  await updating.page.close()

  // 3. 同版本不提示
  const same = await openPage({ version: CURRENT })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(await same.page.$('.update-dialog'), null, '同版本不应提示更新')
  assert.deepEqual(same.errors.filter(isAppError), [], `控制台错误：${same.errors.join(' | ')}`)
  await same.page.close()

  // 4. 请求失败静默
  const failed = await openPage({ status: 500 })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(await failed.page.$('.update-dialog'), null, '请求失败不应提示更新')
  assert.deepEqual(
    failed.errors.filter(isAppError),
    [],
    `控制台错误：${failed.errors.join(' | ')}`,
  )
  await failed.page.close()

  console.log(
    JSON.stringify(
      {
        currentVersion: CURRENT,
        dialogVersion: LATEST,
        dismiss: 'ok',
        reloadUrl: navigatedUrl,
        sameVersion: 'silent',
        requestFailure: 'silent',
      },
      null,
      2,
    ),
  )
  console.log('更新检测自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
