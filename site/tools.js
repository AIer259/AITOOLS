const tools = [
  {
    name: 'AINoteBook',
    description:
      '本地优先的精简 Markdown 笔记应用，支持数学公式、文档关系图、复杂表格、代码高亮、嵌入文档与 PDF 导出。',
    href: './AINoteBook/',
    icon: '📝',
    tags: ['Markdown', '笔记', 'PDF'],
    versionUrl: './AINoteBook/version.json',
  },
]

const grid = document.querySelector('#tool-grid')

function createTag(label) {
  const tag = document.createElement('span')
  tag.className = 'tool-tag'
  tag.textContent = label
  return tag
}

function createCard(tool) {
  const card = document.createElement('a')
  card.className = 'tool-card'
  card.href = tool.href

  const icon = document.createElement('span')
  icon.className = 'tool-icon'
  icon.textContent = tool.icon
  icon.setAttribute('aria-hidden', 'true')

  const body = document.createElement('div')
  body.className = 'tool-body'

  const head = document.createElement('div')
  head.className = 'tool-head'

  const name = document.createElement('h2')
  name.className = 'tool-name'
  name.textContent = tool.name
  head.append(name)

  if (tool.versionUrl) {
    const version = document.createElement('span')
    version.className = 'tool-version'
    version.textContent = 'v—'
    head.append(version)

    fetch(`${tool.versionUrl}?t=${Date.now()}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && typeof data.version === 'string') {
          version.textContent = `v${data.version}`
        } else {
          version.remove()
        }
      })
      .catch(() => {
        version.remove()
      })
  }

  const arrow = document.createElement('span')
  arrow.className = 'tool-arrow'
  arrow.textContent = '→'
  arrow.setAttribute('aria-hidden', 'true')
  head.append(arrow)

  const desc = document.createElement('p')
  desc.className = 'tool-desc'
  desc.textContent = tool.description

  const tags = document.createElement('div')
  tags.className = 'tool-tags'
  for (const tag of tool.tags) tags.append(createTag(tag))

  body.append(head, desc, tags)
  card.append(icon, body)
  return card
}

if (grid) {
  for (const tool of tools) grid.append(createCard(tool))
}
