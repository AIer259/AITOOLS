import type JSZip from 'jszip'

export interface ZipSink {
  write: (chunk: Uint8Array) => Promise<void>
  close: () => Promise<void>
  abort: () => Promise<void>
}

/**
 * 把 JSZip 逐个 chunk 写入目标，写入期间暂停生成，避免整包驻留内存。
 * 调用方负责在成功后 close()，失败后 abort()。
 */
export async function writeZipStream(zip: JSZip, sink: ZipSink): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = zip.generateInternalStream({
      type: 'uint8array',
      streamFiles: true,
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    let queue = Promise.resolve()
    let failed = false

    const fail = (error: unknown) => {
      if (failed) return
      failed = true
      stream.pause()
      reject(error)
    }

    stream.on('data', (chunk) => {
      if (failed) return
      stream.pause()
      queue = queue
        .then(() => {
          if (failed) return
          return sink.write(chunk)
        })
        .then(() => {
          if (!failed) stream.resume()
        })
        .catch(fail)
    })

    stream.on('error', fail)
    stream.on('end', () => {
      queue.then(resolve, reject)
    })
    stream.resume()
  })
}
