declare module 'mammoth' {
  export interface MammothMessage {
    type: string
    message: string
  }

  export interface MammothResult {
    value: string
    messages: MammothMessage[]
  }

  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>
}

declare module 'turndown-plugin-gfm' {
  export const gfm: (service: unknown) => void
  export const tables: (service: unknown) => void
  export const strikethrough: (service: unknown) => void
  export const taskListItems: (service: unknown) => void
}
