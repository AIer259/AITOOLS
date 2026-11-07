import type { ImageToTextPipeline } from '@huggingface/transformers'

export interface MathOcrProgress {
  status: string
  progress: number
  file?: string
}

let pipelinePromise: Promise<ImageToTextPipeline> | null = null

async function getPipeline(onProgress?: (progress: MathOcrProgress) => void) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { env, pipeline } = await import('@huggingface/transformers')
      // 静态站点通常没有 COOP/COEP 头，禁用多线程 wasm 避免 SharedArrayBuffer 失败
      if (env.backends.onnx.wasm) {
        env.backends.onnx.wasm.numThreads = 1
      }
      return pipeline('image-to-text', 'Xenova/texify', {
        dtype: 'q4',
        progress_callback: (info: unknown) => onProgress?.(info as MathOcrProgress),
      })
    })().catch((error) => {
      pipelinePromise = null
      throw error
    })
  }
  return pipelinePromise
}

/** 把公式图片识别为 LaTeX；首次调用会下载并缓存模型，之后可离线使用 */
export async function recognizeMathImage(
  file: Blob,
  onProgress?: (progress: MathOcrProgress) => void,
): Promise<string> {
  const pipe = await getPipeline(onProgress)
  const { RawImage } = await import('@huggingface/transformers')
  const image = await RawImage.fromBlob(file)

  // 模型以白底黑字训练；暗色背景先反色，否则识别结果会严重失真
  let brightness = 0
  let pixels = 0
  for (let i = 0; i < image.data.length; i += 4) {
    brightness += (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3
    pixels += 1
  }
  if (pixels > 0 && brightness / pixels < 128) {
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 255 - image.data[i]
      image.data[i + 1] = 255 - image.data[i + 1]
      image.data[i + 2] = 255 - image.data[i + 2]
    }
  }

  const result = await pipe(image, { max_new_tokens: 384 })
  const text = Array.isArray(result) ? String(result[0]?.generated_text ?? '') : ''
  return text.replace(/^\s*\$\$?/, '').replace(/\$\$?\s*$/, '').trim()
}
