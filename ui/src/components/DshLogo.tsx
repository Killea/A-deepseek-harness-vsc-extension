/**
 * dsh 品牌标（ui/favicon.svg 内联，供启动门/loading 使用）。
 * favicon.svg 只有一条 dark-only 的 fill 规则（`@media (prefers-color-scheme: dark) { path { fill: #fff } }`），
 * 以 <img> 载入时 SVG 内部 <style> 与媒体查询不生效、light 态又无默认 fill → 不可见。
 * 这里剥离 <style> 与根 fill="none"、把 path 强制为 currentColor，随 VS Code 主题着色。
 */
import faviconRaw from '@ui/favicon.svg?raw'

const MARKUP = faviconRaw
  .replace(/<style>[\s\S]*?<\/style>/u, '')
  .replace(/\s*fill="none"/u, '')
  .replace(/\s*width="[^"]*"/u, ' width="100%"')
  .replace(/\s*height="[^"]*"/u, ' height="100%"')
  .replace('<path ', '<path fill="currentColor" ')

export function DshLogo({ size = 48 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block text-foreground"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: MARKUP }}
    />
  )
}
