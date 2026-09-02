/**
 * Easter egg: 宝物掉落 + 拾取交互。
 *
 * 触发：AI 回复完成（running true→false）时由 App.tsx 以一定概率调用 spawn()。
 * 表现：一个 emoji 从聊天区底部浮起，带轻微摆动 + 脉冲光晕。
 * 交互：点击拾取 → 放大淡出 + "+1" 飘字 → 通知扩展侧持久化。
 * 超时：8 秒未拾取自动淡出消失。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TreasureType } from '../../../src/shared/protocol.ts'

const TREASURE_EMOJI: Record<TreasureType, string> = {
  coin: '🪙',
  gem: '💰',
  bill: '💵',
  diamond: '💎',
}

const TREASURE_LABEL: Record<TreasureType, string> = {
  coin: 'Coin',
  gem: 'Gold',
  bill: 'Bill',
  diamond: 'Diamond',
}

/** 权重表（coin 40% · gem 30% · bill 20% · diamond 10%）。 */
const WEIGHTS: Array<{ type: TreasureType; weight: number }> = [
  { type: 'coin', weight: 40 },
  { type: 'gem', weight: 30 },
  { type: 'bill', weight: 20 },
  { type: 'diamond', weight: 10 },
]

/** 随机一个宝物类型（按权重）。 */
export function rollTreasure(): TreasureType {
  const total = WEIGHTS.reduce((s, w) => s + w.weight, 0)
  let r = Math.random() * total
  for (const entry of WEIGHTS) {
    r -= entry.weight
    if (r <= 0) return entry.type
  }
  return 'coin'
}

interface ActiveTreasure {
  id: number
  type: TreasureType
  x: number // 百分比 0-100
}

interface TreasureLayerProps {
  treasure: ActiveTreasure | null
  onPickup: (type: TreasureType) => void
  onExpire: () => void
}

/** 单个宝物的渲染层（绝对定位浮层）。 */
function TreasureLayer({ treasure, onPickup, onExpire }: TreasureLayerProps) {
  const [phase, setPhase] = useState<'float' | 'collected' | 'expired'>('float')
  const [pickupText, setPickupText] = useState<string | null>(null)
  const expireTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // 宝物变化时重置状态 + 启动超时
  useEffect(() => {
    setPhase('float')
    setPickupText(null)
    clearTimeout(expireTimer.current)
    expireTimer.current = setTimeout(() => {
      setPhase('expired')
    }, 8000)
    return () => clearTimeout(expireTimer.current)
  }, [treasure?.id])

  // expired 动画结束后通知父组件清除
  useEffect(() => {
    if (phase === 'expired') {
      const t = setTimeout(onExpire, 600)
      return () => clearTimeout(t)
    }
  }, [phase, onExpire])

  // collected 动画结束后通知父组件清除
  useEffect(() => {
    if (phase === 'collected') {
      const t = setTimeout(onExpire, 700)
      return () => clearTimeout(t)
    }
  }, [phase, onExpire])

  const handleClick = useCallback(() => {
    if (phase !== 'float' || treasure === null) return
    setPhase('collected')
    setPickupText(`+1 ${TREASURE_LABEL[treasure.type]}`)
    onPickup(treasure.type)
  }, [phase, treasure, onPickup])

  if (treasure === null) return null
  const emoji = TREASURE_EMOJI[treasure.type]

  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0 top-0 z-50 overflow-hidden"
      aria-hidden
    >
      {/* 宝物本体 */}
      <button
        type="button"
        className={`pointer-events-auto absolute cursor-pointer select-none border-0 bg-transparent p-0 ${
          phase === 'float'
            ? 'treasure-float'
            : phase === 'collected'
              ? 'treasure-collected'
              : 'treasure-expired'
        }`}
        style={{ left: `${treasure.x}%`, bottom: '8px' }}
        onClick={handleClick}
        title="Pick me!"
      >
        <span className="treasure-glow block text-3xl leading-none">
          {emoji}
        </span>
      </button>
      {/* 拾取飘字 */}
      {pickupText !== null && (
        <span
          className="treasure-pickup-text pointer-events-none absolute text-xs font-medium text-warning"
          style={{ left: `${treasure.x}%`, bottom: '44px' }}
        >
          {pickupText}
        </span>
      )}
    </div>
  )
}

export { TreasureLayer, TREASURE_EMOJI, TREASURE_LABEL }
export type { ActiveTreasure }
