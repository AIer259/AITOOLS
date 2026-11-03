const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

/** 生成严格位于 a 与 b 之间的 fractional-index 字符串；a/b 为 null 表示无边界 */
export function generateKeyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`排序键顺序错误：${a} >= ${b}`)
  }

  let result = ''
  let index = 0
  while (true) {
    const da = a !== null && index < a.length ? DIGITS.indexOf(a[index]) : -1
    const db = b !== null && index < b.length ? DIGITS.indexOf(b[index]) : BASE
    if (db - da > 1) {
      return result + DIGITS[Math.floor((da + db) / 2)]
    }
    result += da >= 0 ? DIGITS[da] : DIGITS[0]
    index += 1
  }
}

export function compareOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 在已有兄弟节点之后追加一个排序键 */
export function nextOrder(siblingOrders: string[]): string {
  const sorted = [...siblingOrders].sort(compareOrder)
  const last = sorted.length > 0 ? sorted[sorted.length - 1] : null
  return generateKeyBetween(last, null)
}
