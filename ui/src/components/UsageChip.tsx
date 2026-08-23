/**
 * UsageChip：输入框下方席位行的上下文占用圆环 + 悬浮 tooltip 展示「会话统计」。
 * 对齐 dsh web 的 ContextMeter（圆环）+ StatsLine（统计条）二面合一：chip 是纯圆环
 * （14px，同 dsh-web 几何），按占用占比三级变色（<75% 中性 / 75–89% 警告 / ≥90% 危险；
 * dsh-web 圆环本身无分级色，此阈值为本插件自定），hover 弹出 tooltip 展示三组详情
 * （上下文占用 / Token 消耗 / 时间），窄窗无内联溢出。数据来自扩展侧推送的
 * UsageStatsView（四投影组合；null/字段缺席 = 静默降级：占用未知时圆环不渲染，
 * tooltip 对应组不显示）。
 *
 * 口径：token 是 provider 计费口径（tokenUsage，四桶不重叠）；时间来自 sessionStats
 * 投影（日志事件 time 折叠，非 timer 服务）；context 占用 provider 锚定
 * （contextPressure），构成三分类（contextBreakdown）为启发式、带 ~ 前缀。
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ContextPressureStatsView,
  SessionStatsView,
  TokenUsageStatsView,
  UsageStatsView,
} from '../../../src/shared/protocol.ts'

/** 圆环几何（对齐 dsh-web ContextMeter：14px viewBox、r5.5、2px 描边）。 */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** 紧凑 token 计数：517 / 12.2K / 517K / 1.2M（对齐 dsh web formatTokens）。 */
function formatTokens(n: number): string {
  const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** 紧凑时长：45.2s（<1 分钟）/ 2m42s（对齐 dsh web formatDuration）。 */
function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** 计费输入 = 三个不重叠的 prompt 侧桶之和（对齐 dsh web billedInputTokens）。 */
function billedInputTokens(usage: TokenUsageStatsView): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** 缓存命中占比（输入为 0 时 null，对齐 dsh web cacheHitPercent）。 */
function cacheHitPercent(usage: TokenUsageStatsView): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0 ? null : Math.round(usage.cacheReadTokens / denominator * 100)
}

/** 占用：projectedTokens 优先、回落 pressureTokens；与 contextWindow 皆备才给占比（上限 100）。 */
function contextOccupancy(
  pressure: ContextPressureStatsView | undefined,
): { percent: number; usedTokens: number; contextWindow: number } | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/** 圆环分级色（dsh-web 圆环无此策略，本插件自定三档）。 */
function ringTier(percent: number): string {
  if (percent >= 90) return 'text-error'
  if (percent >= 75) return 'text-warning'
  return 'text-icon-foreground'
}

/** 构成三分类的展示顺序（系统提示词 / 工具 schema / 对话消息；启发式、带 ~）。 */
const BREAKDOWN_ROWS = [
  { key: 'systemTokens', labelKey: 'usage.systemPrompt' },
  { key: 'toolsTokens', labelKey: 'usage.toolSchema' },
  { key: 'messageTokens', labelKey: 'usage.conversationMessages' },
] as const

interface UsageChipProps {
  /** 当前会话的用量统计组合（null/占用未知 = 圆环不渲染）。 */
  stats: UsageStatsView | null
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-description">{label}</span>
      <span className="min-w-0 truncate font-mono">{value}</span>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium text-description">{title}</h3>
      <div className="space-y-0.5 text-xs">{children}</div>
    </section>
  )
}

function timeRows(sessionStats: SessionStatsView | undefined, t: (key: string, opts?: Record<string, unknown>) => string): React.ReactNode {
  if (sessionStats === undefined || sessionStats.steps <= 0) return null
  const rows: { label: string; value: string }[] = [
    { label: t('usage.turnsSteps'), value: t('usage.turnsStepsValue', { turns: sessionStats.turns, steps: sessionStats.steps }) },
  ]
  if (sessionStats.llmMs > 0) rows.push({ label: t('usage.llmTime'), value: formatDuration(sessionStats.llmMs) })
  if (sessionStats.toolMs > 0) rows.push({ label: t('usage.toolTime'), value: formatDuration(sessionStats.toolMs) })
  if (sessionStats.ttftSteps > 0) {
    rows.push({ label: t('usage.firstTokenAvg'), value: formatDuration(sessionStats.ttftMs / sessionStats.ttftSteps) })
  }
  if (sessionStats.decodeMs > 0) {
    const throughput = Math.round(sessionStats.decodeTokens / (sessionStats.decodeMs / 1_000))
    rows.push({ label: t('usage.decodeSpeed'), value: t('usage.decodeSpeedValue', { speed: throughput }) })
  }
  return rows.map((row) => <Row key={row.label} label={row.label} value={row.value} />)
}

/** tooltip 显示/隐藏延迟（ms）：隐藏前留足时间让鼠标移入 tooltip 内部。 */
const HIDE_DELAY = 200

export function UsageChip({ stats }: UsageChipProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const usage = stats?.tokenUsage
  const sessionStats = stats?.sessionStats
  const pressure = stats?.contextPressure
  const breakdown = stats?.contextBreakdown
  const occupancy = contextOccupancy(pressure)

  const input = usage === undefined ? 0 : billedInputTokens(usage)
  const output = usage?.outputTokens ?? 0
  const showTokens = usage !== undefined && (input > 0 || output > 0)
  const hasBreakdown = breakdown !== undefined
  const cacheHit = usage === undefined ? null : cacheHitPercent(usage)
  const time = timeRows(sessionStats, t)

  const showTooltip = (): void => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setVisible(true)
  }

  const scheduleHide = (): void => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_DELAY)
  }

  // 卸载时清理定时器。
  useEffect(() => {
    return () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current)
    }
  }, [])

  // 纯圆环：占用未知（无 provider 报告 / 无路由容量）→ 不渲染（对齐 dsh-web ContextMeter）。
  if (occupancy === null) return null

  const percent = occupancy.percent
  const dash = `${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={showTooltip}
      onMouseLeave={scheduleHide}
      onFocus={showTooltip}
      onBlur={scheduleHide}
    >
      <button
        type="button"
        className="input-icon-button flex size-6 items-center justify-center rounded-full"
        aria-label={t('usage.contextOccupancy', { percent })}
        tabIndex={0}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
          <circle
            className="text-description/40"
            cx="7"
            cy="7"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle
            className={ringTier(percent)}
            cx="7"
            cy="7"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={dash}
            transform="rotate(-90 7 7)"
          />
        </svg>
      </button>

      {visible && (
        <div
          role="tooltip"
          aria-label={t('usage.sessionStats')}
          className="absolute bottom-full left-0 z-30 mb-2 w-64 max-w-[calc(100vw_-_2rem)] flex-col gap-3 rounded-xs border border-border-panel bg-background p-3 shadow-lg"
          onMouseEnter={showTooltip}
          onMouseLeave={scheduleHide}
        >
          {/* tooltip 小箭头 */}
          <div
            className="absolute left-2 top-full h-0 w-0 border-4 border-transparent border-t-border-panel"
            aria-hidden
          />

          <div className="text-sm">{t('usage.sessionStats')}</div>

          {/* occupancy 已在上文判空返回，此处必然非 null：占用行恒显，构成行仅在 breakdown 在场时显。 */}
          <Group title={t('usage.contextGroup')}>
            <Row
              label={`${occupancy.percent}%`}
              value={`~${formatTokens(occupancy.usedTokens)} / ${formatTokens(occupancy.contextWindow)}`}
            />
            {hasBreakdown && (
              <div className="space-y-0.5">
                {BREAKDOWN_ROWS.map((row) => (
                  <Row
                    key={row.key}
                    label={t(row.labelKey)}
                    value={`~${formatTokens(breakdown[row.key])}`}
                  />
                ))}
              </div>
            )}
          </Group>

          {showTokens && usage !== undefined && (
            <Group title={t('usage.tokenGroup')}>
              <Row label={t('usage.input')} value={formatTokens(input)} />
              <Row label={t('usage.output')} value={formatTokens(output)} />
              {cacheHit !== null && <Row label={t('usage.cacheHit')} value={`${cacheHit}%`} />}
            </Group>
          )}

          {time !== null && <Group title={t('usage.timeGroup')}>{time}</Group>}
        </div>
      )}
    </div>
  )
}
