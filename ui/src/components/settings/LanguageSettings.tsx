/**
 * 「语言」设置页：独立的显示语言选择 tab。
 * 从 GeneralSettings 拆出，让用户在切换语言后仍能直观找到设置入口
 * （避免选了不认识的语言后找不到菜单）。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SettingsPanelView } from '../../../../src/shared/protocol.ts'
import { SUPPORTED_LOCALES, LOCALE_NATIVE_NAMES } from '../../../../src/shared/locales/index.ts'
import type { SettingsWire } from './wire.ts'

interface LanguageSettingsProps {
  panel: SettingsPanelView
  wire: SettingsWire
}

export function LanguageSettings({ panel, wire }: LanguageSettingsProps) {
  const { t } = useTranslation()
  const [localeSaving, setLocaleSaving] = useState(false)
  const [localeSaved, setLocaleSaved] = useState(false)
  const [localeFailure, setLocaleFailure] = useState<string | undefined>(undefined)

  const commitLocale = (target: string | null): void => {
    setLocaleSaving(true)
    setLocaleSaved(false)
    setLocaleFailure(undefined)
    void wire.selectLocale(target).then((reply) => {
      if (!reply.ok) {
        setLocaleFailure(reply.conflict === true ? t('settings.configConflict') : reply.text)
        return
      }
      setLocaleSaved(true)
    }).finally(() => {
      setLocaleSaving(false)
    })
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2">
      <h2 className="text-sm">{t('settings.language')}</h2>

      <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-sm">{t('settings.language')}</span>
            <span className="block text-xs text-description">{t('settings.languageDesc')}</span>
          </span>
        </div>

        {/* 语言列表：每行一个选项，点击即选 */}
        <div className="mt-1 flex flex-col gap-0.5">
          <button
            type="button"
            className={`flex items-center justify-between gap-2 rounded-xs px-2.5 py-1.5 text-left text-sm ${
              (panel.locale ?? '') === ''
                ? 'bg-selection text-selection-foreground'
                : 'hover:bg-list-hover'
            }`}
            disabled={localeSaving}
            onClick={() => commitLocale(null)}
          >
            <span>{t('settings.languageAuto')}</span>
            {(panel.locale ?? '') === '' ? <span className="text-xs">✓</span> : null}
          </button>

          {SUPPORTED_LOCALES.map((code) => {
            const selected = panel.locale === code
            return (
              <button
                key={code}
                type="button"
                className={`flex items-center justify-between gap-2 rounded-xs px-2.5 py-1.5 text-left text-sm ${
                  selected ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'
                }`}
                disabled={localeSaving}
                onClick={() => commitLocale(code)}
              >
                <span>{LOCALE_NATIVE_NAMES[code]}</span>
                {selected ? <span className="text-xs">✓</span> : null}
              </button>
            )
          })}
        </div>

        {localeSaving ? <p className="text-xs text-description">{t('common.saving')}</p> : null}
        {localeSaved ? (
          <p className="text-xs text-success" role="status">{t('common.saved')}</p>
        ) : null}
        {localeFailure !== undefined ? <p className="text-xs text-error">{localeFailure}</p> : null}
      </div>
    </div>
  )
}
