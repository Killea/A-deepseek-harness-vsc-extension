import { useState, type ReactNode } from 'react'
import { parseCodeFences } from '../code-fence.ts'
import { IconCheckOutline14, IconCopyOutline16 } from '../../icons/index.tsx'

/**
 * 助手消息正文渲染：成对 ``` 围栏渲染为带「复制」按钮的代码块，其余文本按
 * 原样保留（whitespace-pre-wrap）。未配对的 ``` 不构成代码块（保持字面文本）。
 */

/** 单个围栏代码块：头部语言提示 + 复制按钮，正文可滚动、等宽不换行。 */
function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1500)
    }, () => undefined)
  }
  return (
    <div className="my-1 overflow-hidden rounded-xs border border-border-panel bg-code-block-background">
      <div className="flex items-center border-b border-border-panel px-2 py-0.5">
        {lang !== '' ? <span className="truncate font-mono text-xxs text-description">{lang}</span> : null}
        <button
          type="button"
          onClick={copy}
          className="ml-auto flex items-center gap-1 rounded-xs px-1 py-0.5 text-xs text-description hover:bg-list-hover hover:text-foreground"
        >
          {copied ? (
            <IconCheckOutline14 size={12} className="text-success" />
          ) : (
            <IconCopyOutline16 size={12} />
          )}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="max-h-[320px] overflow-auto whitespace-pre p-2 font-mono text-xs leading-normal text-code-foreground">
        {text}
      </pre>
    </div>
  )
}

/** 把正文按围栏切段渲染；无围栏时退回单一 plain 文本块（零开销快路径）。 */
export function FencedText({ text, suffix }: { text: string; suffix?: ReactNode }) {
  const segments = parseCodeFences(text)
  if (!segments.some((segment) => segment.type === 'code')) {
    return (
      <div className="whitespace-pre-wrap break-words text-sm leading-5">
        {text}
        {suffix}
      </div>
    )
  }
  return (
    <div className="text-sm leading-5">
      {segments.map((segment, index) =>
        segment.type === 'code' ? (
          <CodeBlock key={index} lang={segment.lang} text={segment.text} />
        ) : segment.text === '' ? null : (
          <div key={index} className="whitespace-pre-wrap break-words">{segment.text}</div>
        ),
      )}
      {suffix}
    </div>
  )
}
