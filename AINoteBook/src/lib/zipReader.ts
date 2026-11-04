const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_SIZE = 22
const MAX_COMMENT = 0xffff

export class StreamingUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamingUnsupportedError'
  }
}

interface CentralEntry {
  method: number
  compressedSize: number
  localOffset: number
}

export interface StreamingZipReader {
  readText: (path: string) => Promise<string | undefined>
  readBlob: (path: string) => Promise<Blob | undefined>
}

interface EocdInfo {
  entries: number
  cdSize: number
  cdOffset: number
}

async function readEocd(file: File): Promise<EocdInfo> {
  const start = Math.max(0, file.size - EOCD_SIZE - MAX_COMMENT)
  const tailBytes = new Uint8Array(await file.slice(start).arrayBuffer())
  const tail = new DataView(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength)

  for (let i = tailBytes.length - EOCD_SIZE; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) !== EOCD_SIGNATURE) continue
    const commentLength = tail.getUint16(i + 20, true)
    if (i + EOCD_SIZE + commentLength !== tailBytes.length) continue

    const disk = tail.getUint16(i + 4, true)
    const cdDisk = tail.getUint16(i + 6, true)
    const entriesOnDisk = tail.getUint16(i + 8, true)
    const entries = tail.getUint16(i + 10, true)
    const cdSize = tail.getUint32(i + 12, true)
    const cdOffset = tail.getUint32(i + 16, true)

    if (
      disk !== 0 ||
      cdDisk !== 0 ||
      entriesOnDisk !== entries ||
      entries === 0xffff ||
      cdSize === 0xffffffff ||
      cdOffset === 0xffffffff
    ) {
      throw new StreamingUnsupportedError('暂不支持 ZIP64 或多分卷备份')
    }
    if (cdOffset + cdSize > file.size) {
      throw new Error('备份 ZIP 中央目录损坏')
    }

    return { entries, cdSize, cdOffset }
  }

  throw new Error('无法读取备份文件，请确认是完整的 ZIP')
}

function parseCentralDirectory(
  file: File,
  info: EocdInfo,
): Promise<Map<string, CentralEntry>> {
  return file
    .slice(info.cdOffset, info.cdOffset + info.cdSize)
    .arrayBuffer()
    .then((buffer) => {
      const bytes = new Uint8Array(buffer)
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const decoder = new TextDecoder('utf-8')
      const entries = new Map<string, CentralEntry>()
      let pos = 0

      for (let index = 0; index < info.entries; index += 1) {
        if (pos + 46 > bytes.length) {
          throw new Error('备份 ZIP 中央目录不完整')
        }
        if (view.getUint32(pos, true) !== CENTRAL_SIGNATURE) {
          throw new Error('备份 ZIP 中央目录格式不正确')
        }

        const flags = view.getUint16(pos + 8, true)
        const method = view.getUint16(pos + 10, true)
        const compressedSize = view.getUint32(pos + 20, true)
        const nameLength = view.getUint16(pos + 28, true)
        const extraLength = view.getUint16(pos + 30, true)
        const commentLength = view.getUint16(pos + 32, true)
        const localOffset = view.getUint32(pos + 42, true)

        if (flags & 0x1) {
          throw new StreamingUnsupportedError('不支持加密的备份 ZIP')
        }
        if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
          throw new StreamingUnsupportedError('暂不支持 ZIP64 备份')
        }
        if (method !== 0 && method !== 8) {
          throw new StreamingUnsupportedError('备份使用了暂不支持的 ZIP 压缩方式')
        }

        const nameStart = pos + 46
        if (nameStart + nameLength > bytes.length) {
          throw new Error('备份 ZIP 文件名损坏')
        }
        const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength))
        entries.set(name, { method, compressedSize, localOffset })

        pos = nameStart + nameLength + extraLength + commentLength
      }

      return entries
    })
}

async function openEntryStream(
  file: File,
  entry: CentralEntry,
): Promise<ReadableStream<Uint8Array>> {
  const localBytes = new Uint8Array(
    await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer(),
  )
  if (localBytes.byteLength < 30) {
    throw new Error('备份 ZIP 局部文件头不完整')
  }
  const local = new DataView(
    localBytes.buffer,
    localBytes.byteOffset,
    localBytes.byteLength,
  )
  if (local.getUint32(0, true) !== LOCAL_SIGNATURE) {
    throw new Error('备份 ZIP 局部文件头格式不正确')
  }

  const nameLength = local.getUint16(26, true)
  const extraLength = local.getUint16(28, true)
  const dataStart = entry.localOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > file.size) {
    throw new Error('备份 ZIP 数据区不完整')
  }

  const stream = file.slice(dataStart, dataEnd).stream()
  if (entry.method === 0) return stream
  return stream.pipeThrough(new DecompressionStream('deflate-raw'))
}

/**
 * 随机读取 ZIP 中央目录，按条目流式解压，不把整个备份读入内存。
 * 仅支持本应用导出的普通 ZIP（STORE / DEFLATE，无加密、无 ZIP64）。
 */
export async function openStreamingZip(file: File): Promise<StreamingZipReader> {
  const info = await readEocd(file)
  const entries = await parseCentralDirectory(file, info)

  if (
    [...entries.values()].some((entry) => entry.method === 8) &&
    typeof DecompressionStream === 'undefined'
  ) {
    throw new StreamingUnsupportedError('当前浏览器不支持流式解压')
  }

  return {
    readText: async (path) => {
      const entry = entries.get(path)
      if (!entry) return undefined
      return new Response(await openEntryStream(file, entry)).text()
    },
    readBlob: async (path) => {
      const entry = entries.get(path)
      if (!entry) return undefined
      return new Response(await openEntryStream(file, entry)).blob()
    },
  }
}
