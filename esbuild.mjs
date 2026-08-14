/**
 * Build script for the dsh-on-vsc extension host bundle.
 * Bundles src/extension.ts -> dist/extension.js (CJS, external: vscode).
 * The webview frontend builds separately via vite (see vite.config.ts).
 */

import * as esbuild from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: [join(root, 'src/extension.ts')],
  outfile: join(root, 'dist/extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
})

if (watch) {
  await ctx.watch()
  console.log('[build] watching extension…')
} else {
  await ctx.rebuild()
  await ctx.dispose()
  console.log('[build] extension bundle done')
}
