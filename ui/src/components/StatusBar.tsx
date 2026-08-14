/** dsh 服务状态行（Cline 风格：细条、描述色文字 + 状态圆点）。 */
import { statusCopy } from '../statusCopy.ts'

interface StatusBarProps {
  status: string
  detail?: string
}

const STATUS_DOT: Record<string, string> = {
  ready: 'bg-success',
  starting: 'animate-pulse bg-warning',
  discovering: 'animate-pulse bg-warning',
  reconnecting: 'animate-pulse bg-warning',
  error: 'bg-error',
  stopped: 'bg-muted-foreground',
}

export function StatusBar({ status, detail }: StatusBarProps) {
  const dot = STATUS_DOT[status] ?? 'bg-muted-foreground'
  const label = statusCopy(status)
  return (
    <div className="flex flex-none flex-col gap-0.5 px-3.5 py-1.5 text-xs text-description">
      <div className="flex items-center gap-1.5">
        <span className={`inline-block size-2 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{label}</span>
      </div>
      {detail !== undefined ? (
        <span className="truncate pl-3.5 text-[11px] leading-tight text-error">{detail}</span>
      ) : null}
    </div>
  )
}
