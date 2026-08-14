/**
 * The markdown renderer's two micromark grammars, one per rendering arm.
 * Mirrors dsh-client-ui-primitives parse.ts so the syntax face matches dsh
 * web: the streaming arm parses GFM only (incomplete TeX never flashes KaTeX
 * errors mid-stream), the settled arm adds TeX math (micromark-extension-math
 * plus the compatibility delimiters).
 */

import type { Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { cjkFriendlyStrong } from './cjkFriendlyStrong.ts'
import { mathCompatibility } from './mathCompatibility.ts'

/**
 * Parse GFM markdown (the streaming arm's grammar: no math).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfm(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

/**
 * Parse GFM markdown plus TeX math with the compatibility delimiters
 * (the settled arm's grammar).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfmWithMath(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong(), mathCompatibility(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
}
