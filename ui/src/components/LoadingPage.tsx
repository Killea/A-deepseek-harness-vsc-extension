/**
 * 启动门 loading 页：dsh 尚未 ready（discovering/starting）时的整页接管。
 * 居中品牌标 + 加载动画 + 状态文案 + detail；无任何导航（自行翻转到 ready/error）。
 */
import { statusCopy } from '../statusCopy.ts'
import { IconLoadingOutline16 } from '../../icons/index.tsx'
import { DshLogo } from './DshLogo.tsx'

export function LoadingPage({ status, detail }: { status: string; detail?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="animate-pulse">
        <DshLogo size={48} />
      </div>
      <IconLoadingOutline16 size={16} className="animate-spin text-description" />
      <p className="text-sm text-description">{statusCopy(status)}</p>
      {detail !== undefined ? <p className="break-words text-xs text-error">{detail}</p> : null}
    </div>
  )
}
