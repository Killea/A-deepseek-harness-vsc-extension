/**
 * Markdown 围栏代码块解析（插件 UI 渲染用）。把一段文本切成普通文本段与代码段：
 * 只有「成对」的 ``` 围栏（开 + 闭）才算代码块；不配对的 ``` 保持原文（按普通文本渲染）。
 * 纯函数、无 DOM 依赖，供 webview 渲染与 vitest 单测共用。
 */

/** 解析结果的一段：普通文本，或一个围栏代码块（lang 为 ``` 后的语言提示，可为空）。 */
export type CodeFenceSegment =
  | { type: 'text'; text: string }
  | { type: 'code'; lang: string; text: string }

/** 围栏行：行首（可带前导空白）三个反引号 + 可选语言提示（不含反引号/换行）。 */
const FENCE_LINE = /^[ \t]*`{3}([^\n`]*)$/

/**
 * 把文本按「成对 ``` 围栏」切段。
 * - 只有配对（开 + 闭）的围栏才是代码块；未配对的开围栏按字面文本处理。
 * - 代码块内容为围栏之间的各行（以 \n 连接，不含开/闭围栏行与其行尾换行）。
 * - 相邻普通文本与代码块之间保留原始换行（text 段用原字符串切片，精确还原）。
 * @param text - 待解析的整段文本。
 * @returns 普通文本段与代码段的有序序列（无围栏时恰为一个 text 段；空串返回空数组）。
 */
export function parseCodeFences(text: string): CodeFenceSegment[] {
  const segments: CodeFenceSegment[] = []
  const lines = text.split('\n')

  // 每一行在原字符串里的起始偏移（供精确切片还原 text 段）。
  const lineStarts: number[] = []
  let cursor = 0
  for (const line of lines) {
    lineStarts.push(cursor)
    cursor += line.length + 1 // +1 = 行尾换行符
  }

  /** 落一行文本段 lines[textStart .. end-1]，用原串切片保留其后的换行。 */
  const pushText = (end: number): void => {
    if (end <= textStart) return
    const from = lineStarts[textStart] ?? 0
    const to = end < lines.length ? (lineStarts[end] ?? text.length) : text.length
    if (to > from) segments.push({ type: 'text', text: text.slice(from, to) })
  }

  let i = 0
  let textStart = 0
  while (i < lines.length) {
    const open = FENCE_LINE.exec(lines[i] ?? '')
    if (open === null) {
      i++
      continue
    }
    // 找配对的开 + 闭围栏；找不到闭围栏则这个 ``` 是字面文本。
    let j = i + 1
    while (j < lines.length && FENCE_LINE.exec(lines[j] ?? '') === null) j++
    if (j >= lines.length) {
      i++
      continue
    }
    pushText(i)
    segments.push({
      type: 'code',
      lang: (open[1] ?? '').trim(),
      text: lines.slice(i + 1, j).join('\n'),
    })
    textStart = j + 1
    i = j + 1
  }
  pushText(lines.length)
  return segments
}
