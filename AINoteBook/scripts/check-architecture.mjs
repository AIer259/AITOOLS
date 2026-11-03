import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')

const RULES = [
  { layer: 'lib', forbidLayers: ['store', 'components'], forbidPackages: [] },
  {
    layer: 'domain',
    forbidLayers: ['store', 'components'],
    forbidPackages: ['react', 'react-dom', 'zustand'],
  },
  {
    layer: 'application',
    forbidLayers: ['store', 'components'],
    forbidPackages: ['react', 'react-dom', 'zustand'],
  },
  { layer: 'store', forbidLayers: ['components'], forbidPackages: [] },
]

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

const violations = []

for (const file of walk(srcDir)) {
  const relative = path.relative(srcDir, file).replace(/\\/g, '/')
  const layer = relative.split('/')[0]
  const rule = RULES.find((item) => item.layer === layer)
  if (!rule) continue

  const source = fs.readFileSync(file, 'utf8')
  const imports = source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)

  for (const match of imports) {
    const specifier = match[1]
    const line = source.slice(0, match.index).split('\n').length

    if (specifier.startsWith('.')) {
      const target = path.resolve(path.dirname(file), specifier)
      const targetLayer = path.relative(srcDir, target).replace(/\\/g, '/').split('/')[0]
      if (rule.forbidLayers.includes(targetLayer)) {
        violations.push(
          `${relative}:${line} imports ${specifier} (${layer} -> ${targetLayer})`,
        )
      }
      continue
    }

    const pkg = rule.forbidPackages.find(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    )
    if (pkg) {
      violations.push(`${relative}:${line} imports ${specifier} (${layer} -> ${pkg})`)
    }
  }
}

if (violations.length > 0) {
  console.error('架构依赖检查失败：')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log('架构依赖检查通过')
