/**
 * ModelSelect：输入框下方的常驻模型席位（对齐 dsh web ui-model-selection 的
 * conversation.input.model）。两级下拉：root 是「模型 / 推理等级」两行，各自
 * 下钻——模型面板（provider 分组 + 勾选 + 描述）与推理等级面板（adapter 公布
 * 档位 + Default）。数据与提交复用 /model 弹层的 session.models /
 * session.selectModel（同一条目录），effort 词汇来自 host 而非客户端自定。
 * 触发按钮显示「模型 · 推理等级」；routable=false 时在条内显示拦截文案、输入
 * 框由 Composer 禁用，本席位仍可操作作为恢复入口。
 */
import { useEffect, useRef, useState } from 'react'
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

type Pane = 'root' | 'model' | 'effort'

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
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const [index, setIndex] = useState(0)
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
        ? 'Default'
        : (reasoning.efforts.find((e) => e.id === effectiveEffort)?.name ?? effectiveEffort)
  const modelLabel = currentModel?.name ?? '选择模型'

  const effortChoices: EffortChoice[] =
    reasoning === undefined
      ? []
      : [
          ...(reasoning.defaultEffort === undefined
            ? [{ key: 'provider-default', effort: undefined as string | undefined, label: 'Default' }]
            : []),
          ...reasoning.efforts.map((e) => ({
            key: `effort:${e.id}`,
            effort: e.id as string | undefined,
            label: e.name,
            ...(e.description === undefined ? {} : { description: e.description }),
          })),
        ]

  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`

  // 每 pane 的可导航条目数（失败/分组标题不参与高亮）。
  const itemCount =
    pane === 'root' ? (reasoning === undefined ? 1 : 2) : pane === 'model' ? modelRows.length : effortChoices.length

  const close = (): void => {
    setOpen(false)
    setPane('root')
    setIndex(0)
  }

  const show = (): void => {
    setPane('root')
    setIndex(0)
    setOpen(true)
    onOpen() // 每次打开重拉目录（对齐 dsh web "every open refreshes"）。
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

  const runAt = (at: number): void => {
    if (pane === 'root') {
      if (at === 0) {
        setPane('model')
        setIndex(0)
      } else {
        setPane('effort')
        setIndex(0)
      }
      return
    }
    if (pane === 'model') {
      const row = modelRows[at]
      if (!row) return
      onSelect(row.groupId, row.model.id)
      close()
      return
    }
    const choice = effortChoices[at]
    if (!choice || current === null) return
    onSelect(current.provider, current.model, choice.effort)
    close()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (pane !== 'root') {
        setPane('root')
        setIndex(0)
      } else {
        close()
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (itemCount === 0) return
      const dir = event.key === 'ArrowDown' ? 1 : -1
      setIndex((index + dir + itemCount) % itemCount)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      runAt(index)
    }
  }

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
    <div ref={rootRef} className="flex items-center justify-end gap-2 px-3.5 pb-1" onKeyDown={onKeyDown}>
      {routableBlocked && (
        <span className="mr-auto text-xs text-error">当前模型不可用，请先选择模型</span>
      )}
      <div className="relative">
        <button
          type="button"
          className="input-icon-button flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs text-description"
          title={triggerLabel}
          disabled={disabled}
          onClick={() => (open ? close() : show())}
        >
          <span className="max-w-[220px] truncate">{triggerLabel}</span>
          <IconChevronDownOutline14 size={14} />
        </button>

        {open && (
          <div className="absolute bottom-full right-0 z-20 mb-1 w-72 overflow-hidden rounded-xs border border-border-panel bg-background shadow-lg">
            {pane === 'root' && (
              <div className="py-1">
                <Cell
                  label="模型"
                  value={modelLabel}
                  highlighted={index === 0}
                  onMouseEnter={() => setIndex(0)}
                  onClick={() => {
                    setPane('model')
                    setIndex(0)
                  }}
                />
                {reasoning !== undefined && (
                  <Cell
                    label="推理等级"
                    value={effortLabel ?? ''}
                    highlighted={index === 1}
                    onMouseEnter={() => setIndex(1)}
                    onClick={() => {
                      setPane('effort')
                      setIndex(0)
                    }}
                  />
                )}
              </div>
            )}

            {pane === 'model' && (
              <div className="max-h-[240px] overflow-y-auto py-1">
                {models === null ? (
                  <Status>加载中…</Status>
                ) : error !== null ? (
                  <ErrorStrip message={error} onRetry={onOpen} />
                ) : null}
                {failures.map((f) => (
                  <div key={f.id} className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-warning">
                    <IconWarningOutline16 size={14} />
                    <span className="min-w-0 flex-1 truncate" title={f.message}>
                      {f.name} 加载失败：{f.message}
                    </span>
                    <button type="button" className="input-icon-button shrink-0" onClick={onOpen}>
                      重试
                    </button>
                  </div>
                ))}
                {models !== null && error === null && modelRows.length === 0 && <Status>没有可用的模型。</Status>}
                {groups.map((group) => (
                  <div key={group.id}>
                    <div className="px-2.5 py-1 text-xs text-description">{group.name}</div>
                    {group.models.map((model) => {
                      const selected = current?.provider === group.id && current.model === model.id
                      const at = modelRows.findIndex((r) => r.groupId === group.id && r.model.id === model.id)
                      return (
                        <ModelCell
                          key={model.id}
                          name={model.name}
                          description={model.description}
                          selected={selected}
                          highlighted={index === at}
                          onMouseEnter={() => setIndex(at)}
                          onClick={() => chooseModel({ groupId: group.id, groupName: group.name, model })}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            )}

            {pane === 'effort' && (
              <div className="max-h-[240px] overflow-y-auto py-1">
                {models === null ? (
                  <Status>加载中…</Status>
                ) : error !== null ? (
                  <ErrorStrip message={error} onRetry={onOpen} />
                ) : null}
                {models !== null && error === null && effortChoices.length === 0 && (
                  <Status>当前模型未提供推理等级。</Status>
                )}
                {effortChoices.map((choice, i) => {
                  const selected = effectiveEffort === choice.effort
                  return (
                    <OptionCell
                      key={choice.key}
                      name={choice.label}
                      description={choice.description}
                      selected={selected}
                      highlighted={index === i}
                      onMouseEnter={() => setIndex(i)}
                      onClick={() => chooseEffort(choice)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Cell({
  label,
  value,
  highlighted,
  onMouseEnter,
  onClick,
}: {
  label: string
  value: string
  highlighted: boolean
  onMouseEnter: () => void
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left ${
        highlighted ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'
      }`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="text-sm">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-xs text-description">
        <span className="min-w-0 truncate">{value}</span>
        <IconChevronRightOutline14 size={14} />
      </span>
    </button>
  )
}

function ModelCell({
  name,
  description,
  selected,
  highlighted,
  onMouseEnter,
  onClick,
}: {
  name: string
  description?: string
  selected: boolean
  highlighted: boolean
  onMouseEnter: () => void
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left ${
        highlighted ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'
      }`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm" title={name}>
          {name}
        </span>
        {description !== undefined && <span className="block truncate text-xs text-description">{description}</span>}
      </span>
      {selected ? <IconCheckOutline16 size={16} /> : null}
    </button>
  )
}

function OptionCell({
  name,
  description,
  selected,
  highlighted,
  onMouseEnter,
  onClick,
}: {
  name: string
  description?: string
  selected: boolean
  highlighted: boolean
  onMouseEnter: () => void
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left ${
        highlighted ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'
      }`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm" title={name}>
          {name}
        </span>
        {description !== undefined && <span className="block truncate text-xs text-description">{description}</span>}
      </span>
      {selected ? <IconCheckOutline16 size={16} /> : null}
    </button>
  )
}

function Status({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-xs text-description">{children}</div>
}

function ErrorStrip({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-error">
      <IconWarningOutline16 size={14} />
      <span className="min-w-0 flex-1 truncate" title={message}>
        模型操作失败：{message}
      </span>
      <button type="button" className="input-icon-button shrink-0" onClick={onRetry}>
        重试
      </button>
    </div>
  )
}
