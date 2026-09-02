/**
 * 「关于」页：插件版本号 + 源码仓库链接 + dsh package 信息（原 PackagePage 合并）。
 * 版本来自扩展侧 package.json version（经 SettingsPanelView.extensionVersion 下发）；
 * 仓库链接为静态常量，点击经 wire.openExternalUrl 由扩展侧在系统浏览器打开。
 * dsh package 部分展示连接位置/版本、扩展运行时设置、settings.yaml 推导路径、
 * 逃生口（打开 VS Code 设置 / 编辑 settings.yaml / 在 dsh web 打开）；未就绪时显示
 * 安装指引 + 手动选路径 + 错误详情，discovering/starting 显示启动中。
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SettingsPanelView, TreasureCounts } from '../../../../src/shared/protocol.ts'
import type { SettingsWire } from './wire.ts'
import goldLogoUrl from '@ui/src/deepseek-color.svg?url'

const REPO_URL = 'https://github.com/Killea/A-deepseek-harness-vsc-extension'
const ORIGINAL_REPO_URL = 'https://github.com/weinibuliu/deepseek-harness-vsc-extension'
const ORIGINAL_AUTHOR = 'weinibuliu'

const SOURCE_LABEL_KEY: Record<string, string> = {
  config: 'settings.sourceConfig',
  path: 'settings.sourcePath',
  'npm-prefix': 'settings.sourceNpmPrefix',
  npx: 'settings.sourceNpx',
}

const OWNERSHIP_LABEL_KEY: Record<string, string> = {
  managed: 'settings.ownershipManaged',
  'external-specified': 'settings.ownershipExternalSpecified',
  'external-discovered': 'settings.ownershipExternalDiscovered',
  'external-managed-port': 'settings.ownershipExternalManagedPort',
}

const INSTALL_CMD = 'npm install -g @deepseek-ai/dsh'

interface AboutPageProps {
  panel: SettingsPanelView | null
  wire: SettingsWire
  onOpenInBrowser: () => void
  /** Easter egg: treasure collection counts. */
  treasureCounts: TreasureCounts | null
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-description">{label}</span>
      {children}
    </div>
  )
}

export function AboutPage({ panel, wire, onOpenInBrowser, treasureCounts }: AboutPageProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(INSTALL_CMD).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1500)
    }, () => undefined)
  }

  const found = panel?.location.found === true
  const ready = panel !== null && (panel.status === 'ready' || panel.status === 'reconnecting')
  const starting = panel !== null && (panel.status === 'discovering' || panel.status === 'starting')
  const error = panel !== null && panel.status === 'error'

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3 py-2">
      <div className="flex items-center gap-2">
        <img src={goldLogoUrl} width={28} height={28} alt="DeepSeek Gold Harness" />
        <h2 className="text-sm">{t('settings.about')}</h2>
      </div>
      <Row label={t('settings.extensionVersion')}>
        {panel === null ? (
          <span className="text-xs text-description">{t('common.loading')}</span>
        ) : (
          <span className="break-all text-xs">{panel.extensionVersion}</span>
        )}
      </Row>
      <Row label={t('settings.sourceRepo')}>
        <button
          type="button"
          className="w-fit break-all text-left text-xs text-link hover:text-link-hover"
          onClick={() => { wire.openExternalUrl(REPO_URL) }}
        >
          {REPO_URL}
        </button>
      </Row>

      <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2.5">
        <Row label={t('settings.originalProject')}>
          <button
            type="button"
            className="w-fit break-all text-left text-xs text-link hover:text-link-hover"
            onClick={() => { wire.openExternalUrl(ORIGINAL_REPO_URL) }}
          >
            {ORIGINAL_REPO_URL}
          </button>
        </Row>
        <Row label={t('settings.originalAuthor')}>
          <button
            type="button"
            className="w-fit text-left text-xs text-link hover:text-link-hover"
            onClick={() => { wire.openExternalUrl(`https://github.com/${ORIGINAL_AUTHOR}`) }}
          >
            @{ORIGINAL_AUTHOR}
          </button>
        </Row>
        <p className="text-xs text-description">{t('settings.forkNotice')}</p>
      </div>

      <section className="flex flex-col gap-3 border-t border-border-panel pt-3">
        <h3 className="text-xs font-medium text-foreground">{t('settings.dshPackage')}</h3>

        <Row label={t('settings.dshConnection')}>
          {panel === null ? (
            <span className="text-xs text-description">{t('common.loading')}</span>
          ) : found && panel.location.found && panel.location.kind === 'launcher' ? (
            <>
              <span className="break-all text-xs" title={panel.location.command}>
                {panel.location.command}
                <span className="ml-1 text-description">({SOURCE_LABEL_KEY[panel.location.source] !== undefined ? t(SOURCE_LABEL_KEY[panel.location.source]!) : panel.location.source})</span>
              </span>
              {panel.location.version ? <span className="text-xs text-description">{t('settings.versionLabel', { version: panel.location.version })}</span> : null}
            </>
          ) : found && panel.location.found && panel.location.kind === 'endpoint' ? (
            <>
              <span className="break-all text-xs" title={panel.location.baseUrl}>{panel.location.baseUrl}</span>
              <span className="text-xs text-description">
                {OWNERSHIP_LABEL_KEY[panel.location.ownership] !== undefined ? t(OWNERSHIP_LABEL_KEY[panel.location.ownership]!) : panel.location.ownership}
                {panel.location.version ? ` · ${t('settings.reportedVersion', { version: panel.location.version })}` : ''}
              </span>
            </>
          ) : (
            <span className="text-xs text-warning">{t('settings.notConnected')}</span>
          )}
        </Row>

        <Row label={t('settings.runtimeSettings')}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-description">{t('settings.configureDsh')}</span>
            <button
              type="button"
              className="flex-none text-xs text-link hover:text-link-hover"
              onClick={() => { wire.openExtensionSettings() }}
            >
              {t('settings.openVscodeSettings')}
            </button>
          </div>
        </Row>

        <Row label={t('settings.settingsYaml')}>
          <div className="flex items-center gap-2">
            <span className="break-all text-xs text-description">
              {panel?.settingsYamlPath ?? ''}
              {panel !== null && panel.hasDocument ? t('settings.settingsYamlExists') : t('settings.settingsYamlMissing')}
            </span>
            <button
              type="button"
              className="flex-none text-xs text-link hover:text-link-hover"
              onClick={() => { wire.openSettingsYaml() }}
            >
              {t('settings.editSettingsYaml')}
            </button>
          </div>
        </Row>

        <div>
          <button
            type="button"
            className="text-xs text-link hover:text-link-hover"
            onClick={onOpenInBrowser}
          >
            {t('settings.openInBrowser')}
          </button>
        </div>

        {/* 未就绪：starting 只显示状态文案；error 显示错误详情 + 重试；stopped 显示安装指引。 */}
        {starting ? (
          <p className="text-xs text-description">{t(`status.${panel?.status ?? ''}`, { defaultValue: panel?.status ?? '' })}</p>
        ) : error ? (
          <div className="flex flex-col gap-2 rounded-xs border border-border-panel p-2">
            <p className="text-xs text-error">{t('status.error')}</p>
            {panel?.statusDetail ? (
              <p className="break-words text-xs text-error">{panel.statusDetail}</p>
            ) : null}
            <button
              type="button"
              className="rounded-xs border border-border-panel px-2.5 py-1.5 text-xs hover:bg-list-hover"
              onClick={() => { wire.restartDsh() }}
            >
              {t('common.retry')}
            </button>
          </div>
        ) : !ready ? (
          <div className="flex flex-col gap-2 rounded-xs border border-border-panel p-2">
            <Row label={t('settings.installCommand')}>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xs bg-code-block-background px-2 py-1 text-xs text-code-foreground">{INSTALL_CMD}</code>
                <button
                  type="button"
                  className="flex-none rounded-xs border border-border-panel px-2 py-1 text-xs hover:bg-list-hover"
                  onClick={copy}
                >
                  {copied ? t('common.copied') : t('common.copy')}
                </button>
              </div>
              <span className="text-xs text-description">{t('settings.installHint')}</span>
            </Row>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="rounded-xs border border-border-panel px-2.5 py-1.5 text-xs hover:bg-list-hover"
                onClick={() => { wire.pickDshPath() }}
              >
                {t('settings.pickDshFile')}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Easter egg: treasure collection stats */}
      {treasureCounts !== null && (
        <section className="flex flex-col gap-2 border-t border-border-panel pt-3">
          <h3 className="text-xs font-medium text-foreground">Treasure Collection</h3>
          <div className="grid grid-cols-4 gap-2">
            {([
              { type: 'coin', emoji: '🪙', label: 'Coins' },
              { type: 'gem', emoji: '💰', label: 'Gold' },
              { type: 'bill', emoji: '💵', label: 'Bills' },
              { type: 'diamond', emoji: '💎', label: 'Diamonds' },
            ] as const).map(({ type, emoji, label }) => (
              <div
                key={type}
                className="flex flex-col items-center gap-0.5 rounded-xs border border-border-panel px-1.5 py-2"
              >
                <span className="text-xl leading-none">{emoji}</span>
                <span className="text-sm font-medium text-foreground">{treasureCounts[type]}</span>
                <span className="text-[10px] text-description">{label}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-description">
            Treasures drop randomly after AI replies. Click to collect!
          </p>
        </section>
      )}
    </div>
  )
}
