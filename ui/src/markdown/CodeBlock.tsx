// CodeBlock: the markdown fence surface — language banner + copy button, with
// shiki highlighting for registered grammars and an identical-geometry plain
// fallback for everything else (and for the streaming arm, which passes no
// lang so fences render plain until the finalize swap).

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { grammarLoadCount, highlightToHtml, subscribeGrammarLoaded } from './highlight.ts'

export interface CodeBlockProps {
  /** The source text, rendered verbatim (trailing newline trimmed for display). */
  code: string
  /** Grammar hint (markdown fence info string); unknown/absent = plain. */
  lang?: string | undefined
  /** Extra class merged onto the wrapper. */
  className?: string | undefined
  /** Copy-button idle label. */
  copyLabel?: string | undefined
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined
}

export function CodeBlock({ code, lang, className, copyLabel = '复制', copiedLabel = '已复制' }: CodeBlockProps) {
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code
  // Re-render when a lazy grammar finishes loading, so a fence that showed
  // plain text while its language's grammar imported picks up highlighting.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const html = useMemo(() => highlightToHtml(trimmed, lang), [trimmed, lang, loaded])
  const rootRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    const text = rootRef.current?.querySelector('pre')?.textContent ?? trimmed
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1500)
    }, () => undefined)
  }, [copied, trimmed])

  return (
    <div
      ref={rootRef}
      className={['my-1 overflow-hidden rounded-xs border border-border-panel bg-code-block-background', className ?? ''].join(' ')}
    >
      <div className="flex items-center border-b border-border-panel px-2 py-0.5">
        {lang ? <span className="truncate font-mono text-xxs text-description">{lang}</span> : null}
        <button
          type="button"
          onClick={onCopy}
          className="ml-auto flex items-center gap-1 rounded-xs px-1 py-0.5 text-xs text-description hover:bg-list-hover hover:text-foreground"
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      {html === undefined ? (
        <pre className="max-h-[320px] overflow-auto whitespace-pre p-2 font-mono text-xs leading-normal text-code-foreground">
          <code>{trimmed}</code>
        </pre>
      ) : (
        // shiki's output is a static span tree it generated from `code` (no
        // user HTML passes through), the sanctioned innerHTML consumption path.
        <div dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  )
}
