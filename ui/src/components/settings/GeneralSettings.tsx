/**
 * 「通用」页（对齐 dsh web General 页里的 Permission 行）：一行「默认权限模式」，
 * 写 permission settings namespace 的 defaultPreset（决定**未来**会话的初始权限，
 * 不改当前会话）。选项来自扩展侧解析的 schema 枚举；切到 Full access 先弹风险确认门。
 * permission namespace 缺席（能力缺席）→ 显示空态而非报错。
 */
import { useState } from 'react'
import type { SettingsPanelView } from '../../../../src/shared/protocol.ts'
import { FULL_ACCESS_PRESET, permissionLabel } from '../../permission.ts'
import type { SettingsWire } from './wire.ts'

interface GeneralSettingsProps {
  panel: SettingsPanelView
  wire: SettingsWire
}

export function GeneralSettings({ panel, wire }: GeneralSettingsProps) {
  const [pending, setPending] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const permission = panel.permissionDefault
  if (permission === undefined) {
    return (
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2">
        <h2 className="text-sm">通用</h2>
        <p className="text-xs text-description">当前 dsh 未提供权限设置能力。</p>
      </div>
    )
  }

  const currentValue = permission.currentValue
  const readOnly = !permission.writable

  const commit = (target: string): void => {
    setSaving(true)
    setFailure(undefined)
    void wire.selectPermissionDefault(target, permission.revision).then((reply) => {
      if (!reply.ok) {
        setFailure(reply.conflict === true ? '配置已被其它编辑修改，请刷新后重试' : reply.text)
        return
      }
      setSaved(target)
    }).finally(() => {
      setSaving(false)
      setPending(null)
      setAcknowledged(false)
    })
  }

  const choose = (target: string): void => {
    if (target === currentValue) return
    setSaved(undefined)
    setFailure(undefined)
    if (target === FULL_ACCESS_PRESET) {
      setAcknowledged(false)
      setPending(target)
      return
    }
    commit(target)
  }

  const cancel = (): void => {
    setPending(null)
    setAcknowledged(false)
    setFailure(undefined)
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2">
      <h2 className="text-sm">通用</h2>
      {readOnly ? <p className="text-xs text-warning">设置只读</p> : null}

      <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-sm">默认权限模式</span>
            <span className="block text-xs text-description">选择新会话的默认权限模式</span>
          </span>
          <select
            className="max-w-[180px] flex-none rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
            value={pending ?? currentValue}
            disabled={readOnly || saving}
            aria-label="默认权限模式"
            onChange={(event) => choose(event.target.value)}
          >
            {permission.options.map((option) => (
              <option key={option.id} value={option.id}>{permissionLabel(option.id, option.name)}</option>
            ))}
          </select>
        </div>
        {saving ? <p className="text-xs text-description">保存中…</p> : null}
        {saved !== undefined ? <p className="text-xs text-success" role="status">已保存</p> : null}
        {failure !== undefined ? <p className="text-xs text-error">{failure}</p> : null}
      </div>

      {pending !== null && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
          <div className="flex w-[85%] max-w-sm flex-col gap-2 rounded-xs border border-border-panel bg-background p-3 shadow-lg">
            <div className="text-sm">确认启用「完全访问」？</div>
            <p className="text-xs text-description">
              启用后，新会话将减少确认步骤，并可直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。
            </p>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span className="min-w-0">我已了解风险，并愿意继续</span>
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover"
                onClick={cancel}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-xs bg-button-background px-2.5 py-1 text-xs text-button-foreground hover:bg-button-hover disabled:opacity-50"
                disabled={!acknowledged || saving}
                onClick={() => commit(FULL_ACCESS_PRESET)}
              >
                启用完全访问
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
