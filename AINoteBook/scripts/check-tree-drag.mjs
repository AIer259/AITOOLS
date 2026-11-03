import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const now = Date.now()

const tree = [
  {
    id: 'folder-source',
    area: 'space',
    parentId: null,
    kind: 'folder',
    name: '工作区',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'main-note',
    area: 'space',
    parentId: 'folder-source',
    kind: 'doc',
    name: '主文件',
    docType: 'md',
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '主文件内容' }] },
        {
          type: 'documentEmbed',
          attrs: { docId: 'embed-doc', name: '附件文档', docType: 'md' },
        },
      ],
    },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'attach-folder',
    area: 'space',
    parentId: 'folder-source',
    kind: 'folder',
    name: '主文件附件',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'embed-doc',
    area: 'space',
    parentId: 'attach-folder',
    kind: 'doc',
    name: '附件文档',
    docType: 'md',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '附件内容' }] }],
    },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'folder-target',
    area: 'space',
    parentId: null,
    kind: 'folder',
    name: '目标文件夹',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'folder-conflict',
    area: 'space',
    parentId: null,
    kind: 'folder',
    name: '冲突目标',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'conflict-attach',
    area: 'space',
    parentId: 'folder-conflict',
    kind: 'folder',
    name: '主文件附件',
    createdAt: now,
    updatedAt: now,
  },
]

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-tree-drag-'))
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

async function readTree() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store')
      request.onupgradeneeded = () => request.result.createObjectStore('keyval')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readonly')
      const request = tx.objectStore('keyval').get('ainb.tree.v2')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  })
}

async function waitForTree(check, timeout = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const nodes = await readTree()
    if (check(nodes)) return nodes
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error('等待树状态超时')
}

async function dragToRow(sourceName, targetName) {
  await page.evaluate(
    ({ source, target }) => {
      const rows = [...document.querySelectorAll('.tree-row')]
      const sourceRow = rows.find(
        (row) => row.querySelector('.row-name')?.textContent === source,
      )
      const targetRow = rows.find(
        (row) => row.querySelector('.row-name')?.textContent === target,
      )
      if (!sourceRow || !targetRow) throw new Error('拖拽行不存在')

      const data = new DataTransfer()
      sourceRow.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
      targetRow.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
      targetRow.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
      sourceRow.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
    },
    { source: sourceName, target: targetName },
  )
}

async function dragToArea(sourceName, areaLabel) {
  await page.evaluate(
    ({ source, area }) => {
      const sourceRow = [...document.querySelectorAll('.tree-row')].find(
        (row) => row.querySelector('.row-name')?.textContent === source,
      )
      const section = [...document.querySelectorAll('.tree-section')].find(
        (item) => item.querySelector('.section-title')?.textContent?.trim() === area,
      )
      const head = section?.querySelector('.section-head')
      if (!sourceRow || !head) throw new Error('拖拽区域不存在')

      const data = new DataTransfer()
      sourceRow.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
      head.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
      head.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
      sourceRow.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
    },
    { source: sourceName, area: areaLabel },
  )
}

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.paper')

  await page.evaluate(async (nodes) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store')
      request.onupgradeneeded = () => request.result.createObjectStore('keyval')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readwrite')
      tx.objectStore('keyval').clear()
      tx.objectStore('keyval').put(nodes, 'ainb.tree.v1')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    localStorage.setItem('ainb.active.v1', 'main-note')
  }, tree)

  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('.note-title')?.value === '主文件')

  // 附件文件夹默认折叠，展开后才能看到其中的文档
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.tree-row')].find(
      (item) => item.querySelector('.row-name')?.textContent === '主文件附件',
    )
    row?.querySelector('.chevron-btn')?.click()
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.row-name')].some((item) => item.textContent === '附件文档'),
  )

  const draggableFlags = await page.evaluate(() => {
    const find = (name) =>
      [...document.querySelectorAll('.tree-row')].find(
        (row) => row.querySelector('.row-name')?.textContent === name,
      )?.draggable
    return {
      main: find('主文件'),
      attachmentFolder: find('主文件附件'),
      embeddedDoc: find('附件文档'),
      normalFolder: find('工作区'),
    }
  })
  assert.deepEqual(draggableFlags, {
    main: true,
    attachmentFolder: false,
    embeddedDoc: false,
    normalFolder: true,
  })

  // 嵌入文档与附件文件夹不能被单独拖走
  await dragToRow('附件文档', '目标文件夹')
  await new Promise((resolve) => setTimeout(resolve, 400))
  let nodes = await readTree()
  assert.equal(nodes.find((node) => node.id === 'embed-doc').parentId, 'attach-folder')
  assert.equal(nodes.find((node) => node.id === 'attach-folder').parentId, 'folder-source')

  await dragToRow('主文件附件', '目标文件夹')
  await new Promise((resolve) => setTimeout(resolve, 400))
  nodes = await readTree()
  assert.equal(nodes.find((node) => node.id === 'attach-folder').parentId, 'folder-source')
  assert.equal(nodes.find((node) => node.id === 'main-note').parentId, 'folder-source')

  // 主文件与附件文件夹一起移动到普通文件夹
  await dragToRow('主文件', '目标文件夹')
  nodes = await waitForTree(
    (items) => items.find((item) => item.id === 'main-note')?.parentId === 'folder-target',
  )
  assert.equal(nodes.find((node) => node.id === 'attach-folder').parentId, 'folder-target')
  assert.equal(nodes.find((node) => node.id === 'embed-doc').parentId, 'attach-folder')
  assert.equal(nodes.find((node) => node.id === 'embed-doc').area, 'space')

  // 普通文件夹拖拽
  await dragToRow('工作区', '目标文件夹')
  nodes = await waitForTree(
    (items) => items.find((item) => item.id === 'folder-source')?.parentId === 'folder-target',
  )

  // 主文件与附件跨区域移动，附件子树的 area 同步更新
  await dragToArea('主文件', '私人')
  nodes = await waitForTree((items) => {
    const main = items.find((item) => item.id === 'main-note')
    return main?.area === 'private' && main.parentId === null
  })
  assert.equal(nodes.find((node) => node.id === 'attach-folder').parentId, null)
  assert.equal(nodes.find((node) => node.id === 'attach-folder').area, 'private')
  assert.equal(nodes.find((node) => node.id === 'embed-doc').area, 'private')

  // 目标位置已有同名附件文件夹时阻止移动
  await dragToRow('主文件', '冲突目标')
  await new Promise((resolve) => setTimeout(resolve, 500))
  nodes = await readTree()
  const main = nodes.find((node) => node.id === 'main-note')
  assert.equal(main.area, 'private')
  assert.equal(main.parentId, null)
  assert.equal(nodes.find((node) => node.id === 'attach-folder').parentId, null)
  assert.ok(
    nodes.every((node) => typeof node.order === 'string' && node.order.length > 0),
    '节点缺少 fractional-index order',
  )
  assert.equal(
    nodes.find((node) => node.id === 'main-note').attachmentFolderId,
    'attach-folder',
    '主文档缺少 attachmentFolderId',
  )
  assert.equal(
    nodes.find((node) => node.id === 'attach-folder').ownerDocId,
    'main-note',
    '附件文件夹缺少 ownerDocId',
  )

  assert.deepEqual(errors, [], `控制台错误：${errors.join(' | ')}`)
  console.log(
    JSON.stringify(
      {
        draggableFlags,
        mainAfterMove: { area: main.area, parentId: main.parentId },
        attachmentArea: nodes.find((node) => node.id === 'attach-folder').area,
        embedArea: nodes.find((node) => node.id === 'embed-doc').area,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log('侧栏拖拽自测全部通过')
} finally {
  await browser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
