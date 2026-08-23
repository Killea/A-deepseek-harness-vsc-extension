/**
 * ModelSelect：输入框下方的常驻模型席位（对齐 Codex 单面板模式）。
 * 点击按钮弹出一个下拉面板，面板内分两个区域：
 *   1. 推理等级区域（始终可见，直接可选，1 次点击切换）
 *   2. hr 分隔线
 *   3. 模型区域（默认只显示当前模型行，点击该行展开完整模型列表）
 * 数据与提交复用 session.models / session.selectModel（同一条目录），
 * effort 词汇来自 host 而非客户端自定。
 * routable=false 时在条内显示拦截文案、输入框由 Composer 禁用，
 * 本席位仍可操作作为恢复入口。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelEntryView, SessionModelsView } from '../../../src/shared/protocol.ts'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconWarningOutline16,
} from '../../icons/index.tsx'

interface ModelSelectProps {
  /** 目录快照（null = 尚未加载）。 */
  models: SessionModelsView | null
  /** 打开/重试 → 扩展侧重拉 session.models。 */
  onOpen: () => void
  /** 选中模型或推理等级（effort 缺席 = 回落模型默认）。 */
  onSelect: (provider: string, model: string, effort?: string) => void
  /** running / 未就绪时锁定触发按钮（routable 拦截不锁席位）。 */
  disabled: boolean
}

interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

interface ModelRow {
  groupId: string
  groupName: string
  model: ModelEntryView
}

export function ModelSelect({ models, onOpen, onSelect, disabled }: ModelSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [modelExpanded, setModelExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const groups = models?.groups ?? []
  const failures = models?.failures ?? []
  const error = models?.error ?? null
  const current = models?.current ?? null
  const routableBlocked = models !== null && models.routable === false

  const modelRows: ModelRow[] = groups.flatMap((g) =>
    g.models.map((model) => ({ groupId: g.id, groupName: g.name, model })),
  )
  const currentModel =
    current === null
      ? null
      : (modelRows.find((r) => r.groupId === current.provider && r.model.id === current.model)?.model ?? null)
  const reasoning = currentModel?.reasoning
  const effectiveEffort = current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel =
    reasoning === undefined
      ? undefined
      : effectiveEffort === undefined
        ? t('common.default')
        : (reasoning.efforts.find((e) => e.id === effectiveEffort)?.name ?? effectiveEffort)
  const modelLabel = currentModel?.name ?? t('modelSelect.selectModel')

  const effortChoices: EffortChoice[] =
    reasoning === undefined
      ? []
      : [
          ...(reasoning.defaultEffort === undefined
            ? [{ key: 'provider-default', effort: undefined as string | undefined, label: t('common.default') }]
            : []),
          ...reasoning.efforts.map((e) => ({
            key: `effort:${e.id}`,
            effort: e.id as string | undefined,
            label: e.name,
            ...(e.description === undefined ? {} : { description: e.description }),
          })),
        ]

  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`

  const close = (): void => {
    setOpen(false)
    setModelExpanded(false)
  }

  const show = (): void => {
    setModelExpanded(false)
    setOpen(true)
    onOpen()
  }

  // 点击外部关闭。
  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Escape 关闭。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const chooseModel = (row: ModelRow): void => {
    onSelect(row.groupId, row.model.id)
    close()
  }

  const chooseEffort = (choice: EffortChoice): void => {
    if (current === null) return
    onSelect(current.provider, current.model, choice.effort)
    close()
  }

  return (
    <div ref={rootRef} className="flex min-w-0 flex-wrap items-center gap-2">
      {routableBlocked && (
        <span className="w-full text-xs text-error">{t('modelSelect.routableBlocked')}</span>
      )}
      <div className="relative min-w-0">
        <button
          type="button"
          className="input-icon-button flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs text-description"
          title={triggerLabel}
          disabled={disabled}
          onClick={() => (open ? close() : show())}
        >
          <span className="min-w-0 max-w-[220px] truncate">{triggerLabel}</span>
          <IconChevronDownOutline14 size={14} />
        </button>

        {open && (
          <div className="absolute bottom-full right-0 z-20 mb-1 w-72 max-w-[calc(100vw_-_2rem)] overflow-hidden rounded-xs border border-border-panel bg-background shadow-lg">
            {/* ---- 推理等级区域（始终可见，直接可选） ---- */}
            {reasoning !== undefined && (
              <div className="py-1">
                <div className="px-2.5 pb-1 pt-1 text-xs font-medium text-description">
                  {t('modelSelect.reasoningLevel')}
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  {effortChoices.map((choice) => {
                    const selected = effectiveEffort === choice.effort
                    return (
                      <button
                        key={choice.key}
                        type="button"
                        className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left ${
                          selected ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'
                        }`}
                        onClick={() => chooseEffort(choice)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm" title={choice.label}>
                            {choice.label}
                          </span>
                          {choice.description !== undefined && (
                            <span className="block truncate text-xs text-description">{choice.description}</span>
                          )}
                        </span>
                        {selected ? <IconCheckOutline16 size={16} /> : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ---- hr 分隔线 ---- */}
            <div className="border-t border-border-panel" />

            {/* ---- 模型区域 ---- */}
            <div className="py-1">
              {/* 当前模型行（点击展开/收起完整列表） */}
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-list-hover"
                onClick={() => setModelExpanded((v) => !v)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm" title={modelLabel}>
                    {modelLabel}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-description">
                  {modelExpanded ? <IconChevronDownOutline14 size={14} /> : <IconChevronRightOutline14 size={14} />}
                </span>
              </button>

              {/* 展开后的完整模型列表 */}
              {modelExpanded && (
                <div className="max-h-[240px] overflow-y-auto">
                  {models === null ? (
                    <Status>{t('modelSelect.loadingModels')}</Status>
                  ) : error !== null ? (
                    <ErrorStrip message={error} onRetry={onOpen} />
                  ) : null}
                  {failures.map((f) => (
                    <div key={f.id} className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-warning">
                      <IconWarningOutline16 size={14} />
                      <span className="min-w-0 flex-1 truncate" title={f.message}>
                        {t('modelSelect.modelLoadFailed', { name: f.name, message: f.message })}
                      </span>
                      <button type="button" className="input-icon-button shrink-0" onClick={onOpen}>
                        {t('common.retry')}
                      </button>
                    </div>
                  ))}
                  {models !== null && error === null && modelRows.length === 0 && (
                    <Status>{t('modelSelect.noModelsAvailable')}</Status>
                  )}
                  {groups.map((group) => (
                    <div key={group.id}>
                      <div className="px-2.5 py-1 text-xs text-description">{group.name}</div>
                      {group.models.map((model) => {
                        const selected = current?.provider === group.id && current.model === model.id
                        return (
                          <button
                            key={model.id}
                            type="button"
                            className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left ${
                              selected ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'
                            }`}
                            onClick={() => chooseModel({ groupId: group.id, groupName: group.name, model })}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm" title={model.name}>
                                {model.name}
                              </span>
                              {model.description !== undefined && (
                                <span className="block truncate text-xs text-description">{model.description}</span>
                              )}
                            </span>
                            {selected ? <IconCheckOutline16 size={16} /> : null}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Status({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-xs text-description">{children}</div>
}

function ErrorStrip({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-error">
      <IconWarningOutline16 size={14} />
      <span className="min-w-0 flex-1 truncate" title={message}>
        {t('modelSelect.modelOperationFailed', { message })}
      </span>
      <button type="button" className="input-icon-button shrink-0" onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  )
}
