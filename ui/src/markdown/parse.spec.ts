import { describe, expect, it } from 'vitest'
import { parseGfm, parseGfmWithMath } from './parse.ts'

describe('parseGfm (streaming arm)', () => {
  it('parses GFM block constructs to their mdast node types', () => {
    const root = parseGfm([
      '# Heading',
      '',
      '- a',
      '- b',
      '',
      '| h |',
      '| - |',
      '| c |',
      '',
      '> quote',
      '',
      '~~~',
      'fenced',
      '~~~',
    ].join('\n'))
    expect(root.children.map(node => node.type)).toEqual([
      'heading', 'list', 'table', 'blockquote', 'code',
    ])
  })

  it('parses inline constructs (strong, delete, inline code, link)', () => {
    const root = parseGfm('**bold** ~~gone~~ `code` [x](https://example.com)')
    const paragraph = root.children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('expected paragraph')
    expect(paragraph.children.map(node => node.type)).toEqual([
      'strong', 'text', 'delete', 'text', 'inlineCode', 'text', 'link',
    ])
  })

  it('parses footnotes and task-list items (GFM extensions)', () => {
    const root = parseGfm('- [x] done\n\nnote[^1]\n\n[^1]: body')
    const list = root.children[0]
    expect(list?.type).toBe('list')
    if (list?.type !== 'list') throw new Error('expected list')
    expect(list.children[0]?.type).toBe('listItem')
    expect(root.children.some(node => node.type === 'footnoteDefinition')).toBe(true)
    expect(root.children.some(node => node.type === 'paragraph' && 'children' in node
      && node.children.some(child => child.type === 'footnoteReference'))).toBe(true)
  })

  it('keeps raw HTML as an html node (rendered literally downstream)', () => {
    const root = parseGfm('<b>x</b>')
    expect(root.children[0]?.type).toBe('html')
  })
})

describe('parseGfmWithMath (settled arm)', () => {
  it('parses inline and display TeX math', () => {
    const root = parseGfmWithMath('$x$ and $$y$$')
    const paragraph = root.children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('expected paragraph')
    expect(paragraph.children.some(node => node.type === 'inlineMath')).toBe(true)
    expect(root.children.some(node => node.type === 'math')).toBe(true)
  })

  it('parses compatibility delimiters \\( … \\) and \\[ … \\]', () => {
    const root = parseGfmWithMath('text \\(a+b\\) and \\[c\\]')
    const paragraph = root.children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('expected paragraph')
    expect(paragraph.children.some(node => node.type === 'inlineMath')).toBe(true)
  })

  it('does not parse math in the streaming (GFM-only) grammar', () => {
    const root = parseGfm('$x$')
    const paragraph = root.children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('expected paragraph')
    expect(paragraph.children.every(node => node.type === 'text')).toBe(true)
  })
})
