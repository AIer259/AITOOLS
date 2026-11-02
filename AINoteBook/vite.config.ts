import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import pkg from './package.json' with { type: 'json' }

function versionFile(): Plugin {
  return {
    name: 'ainb-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: pkg.version }),
      })
    },
  }
}

export function createConfig(base = '/') {
  return defineConfig({
    base,
    plugins: [react(), versionFile()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
      port: 5174,
      strictPort: true,
    },
  })
}

export default createConfig()
