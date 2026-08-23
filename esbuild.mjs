/**
 * Build script for the dsh-on-vsc extension host bundle.
 * Bundles src/extension.ts -> dist/extension.js (CJS, external: vscode).
 * The webview frontend builds separately via vite (see vite.config.ts).
 */

import * as esbuild from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

/** esbuild plugin: strip comments from .jsonc files so the json loader accepts them. */
const jsoncPlugin = {
  name: 'jsonc',
  setup(build) {
    build.onLoad({ filter: /\.jsonc$/ }, (args) => {
      const raw = readFileSync(args.path, 'utf8')
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/(^|[^:])\/\/.*$/gmu, '$1')
      return { contents: stripped, loader: 'json' }
    })
  },
}

const ctx = await esbuild.context({
  entryPoints: {
    extension: join(root, 'src/extension.ts'),
    'dsh-runtime-broker': join(root, 'src/dsh/runtime-broker-main.ts'),
  },
  outdir: join(root, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
  plugins: [jsoncPlugin],
})

if (watch) {
  await ctx.watch()
  console.log('[build] watching extension…')
} else {
  await ctx.rebuild()
  await ctx.dispose()
  console.log('[build] extension bundle done')
}
