import { imageMimeFromName, saveImageAsset } from './imageAssets'

export type ImageSourceResolver = (src: string) => Promise<Blob | null>

async function dataUrlToBlob(src: string): Promise<Blob | null> {
  try {
    const response = await fetch(src)
    return await response.blob()
  } catch {
    return null
  }
}

function hasVisibleContent(fragment: DocumentFragment): boolean {
  return Boolean(
    fragment.textContent?.trim() ||
      fragment.querySelector('img, br, hr, table, ul, ol, blockquote, pre'),
  )
}

function createBlockImage(alt: string, assetId: string, path: string): HTMLImageElement {
  const image = document.createElement('img')
  image.setAttribute('data-note-image', '')
  image.setAttribute('data-asset-id', assetId)
  image.setAttribute('data-path', path)
  image.setAttribute('alt', alt)
  return image
}

/** 把段落内的图片拆成独立块：前段 + 图片 + 后段，避免 Tiptap 丢弃块级图片 */
function replaceWithBlock(image: HTMLImageElement, block: HTMLImageElement): void {
  const anchor = image.closest('a')
  if (anchor && anchor.querySelectorAll('img').length === 1 && !anchor.textContent?.trim()) {
    anchor.replaceWith(image)
  }

  const paragraph = image.parentElement?.closest('p')
  if (!paragraph) {
    image.replaceWith(block)
    return
  }

  if (paragraph.childNodes.length === 1 && paragraph.firstChild === image) {
    paragraph.replaceWith(block)
    return
  }

  const before = document.createDocumentFragment()
  const after = document.createDocumentFragment()
  let seen = false

  for (const child of Array.from(paragraph.childNodes)) {
    if (child === image) {
      seen = true
      continue
    }
    ;(seen ? after : before).appendChild(child)
  }

  image.remove()

  const replacement: Node[] = []
  if (hasVisibleContent(before)) {
    const leading = document.createElement('p')
    leading.append(before)
    replacement.push(leading)
  }
  replacement.push(block)
  if (hasVisibleContent(after)) {
    const trailing = document.createElement('p')
    trailing.append(after)
    replacement.push(trailing)
  }

  paragraph.replaceWith(...replacement)
}

/**
 * 把 Markdown 生成的普通 <img> 转成应用图片资源：
 * data URI 直接解码；相对路径交给 resolver（ZIP 导入）；找不到的图片保留 alt 文字。
 */
export async function importMarkdownImages(
  html: string,
  noteName: string,
  resolve: ImageSourceResolver,
): Promise<string> {
  const container = document.createElement('div')
  container.innerHTML = html

  for (const image of Array.from(container.querySelectorAll('img'))) {
    // 容器本身是离屏节点，isConnected 不可用；没有父节点说明已被前一次替换移走
    if (!image.parentElement) continue

    const src = image.getAttribute('src')?.trim() ?? ''
    const alt = image.getAttribute('alt') ?? ''

    let blob: Blob | null = null
    if (src.startsWith('data:')) blob = await dataUrlToBlob(src)
    else if (!/^https?:/i.test(src)) blob = await resolve(src)

    if (!blob) {
      const fallback = alt.trim() || src
      if (fallback) image.replaceWith(document.createTextNode(fallback))
      else image.remove()
      continue
    }

    try {
      const mime = blob.type.startsWith('image/') ? blob.type : imageMimeFromName(src || alt)
      const file = new File([blob], alt.trim() || '导入图片', { type: mime })
      const saved = await saveImageAsset(file, noteName)
      replaceWithBlock(image, createBlockImage(alt, saved.meta.id, saved.path))
    } catch {
      image.remove()
    }
  }

  return container.innerHTML
}
