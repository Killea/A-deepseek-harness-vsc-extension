import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconCheckOutline16,
  IconEyeOffOutline16,
  IconEyeOutline16,
  IconSendOutline16,
  IconStopFill16,
} from '../../icons/index.tsx'
import type {
  ActiveFileView,
  AtCandidatesView,
  AtRefPayload,
  AgentPresetSelectView,
  CommandDescriptorView,
  ComposerSubmitGesture,
  ImageAttachmentInput,
  PermissionSelectView,
  SessionModelsView,
  SessionSummary,
  SkillsSnapshot,
  TodoItem,
  UsageStatsView,
} from '../../../src/shared/protocol.ts'
import { detectTrigger, type TriggerGuardTier } from '../../../src/shared/trigger.ts'
import {
  initialMenuState,
  insertionGap,
  menuReduce,
  permissionOptions,
  visibleAtItems,
  visibleCommandRows,
  currentModelGroup,
  type MenuEntry,
  type MenuState,
} from '../../../src/shared/menu.ts'
import { commandDescription } from '../commands-i18n.ts'
import { permissionLabel } from '../permission.ts'
import { TodoStrip } from './TodoStrip.tsx'
import { ModelSelect } from './ModelSelect.tsx'
import { PermissionSelect } from './PermissionSelect.tsx'
import { UsageChip } from './UsageChip.tsx'
import { AgentPresetSelect } from './AgentPresetSelect.tsx'

interface ComposerProps {
  text: string
  onTextChange: (text: string) => void
  /** Incremented only after the owning service action is accepted. */
  commitSeq: number
  /** 发送：attachments = 眼睛启用的自动附带文件（绝对路径，扩展侧构造 @ 引用）。 */
  onSend: (text: string, gesture: ComposerSubmitGesture, attachments: string[], images?: ImageAttachmentInput[]) => void
  onCancel: () => void
  /** @ 菜单打开 → 扩展侧枚举候选。 */
  onAtOpen: () => void
  /** @ 菜单选中 → 扩展侧构造插入文本。 */
  onAtResolve: (ref: AtRefPayload) => void
  /** 扩展侧枚举到的 @ 候选（文件 + 问题）。 */
  atCandidates: AtCandidatesView | null
  /** 扩展侧构造好的 @ 插入文本；非 null 时替换触发 token。 */
  atInsert: string | null
  onAtInsertConsumed: () => void
  /** 自动附带：当前活动编辑器文件（输入框下方文件条；null = 隐藏）。 */
  activeFile: ActiveFileView | null
  /** 自动附带：眼睛开关状态（true = 该文件随消息作为 @ 引用发送）。 */
  activeFileEnabled: boolean
  /** 自动附带：眼睛开关点击 → 翻转启用态。 */
  onActiveFileToggle: (enabled: boolean) => void
  /** Drop Zone TreeView 拖入的文件路径 → 插入到 textarea 光标处作为 @ 引用。 */
  insertAtCursor: { seq: number; text: string } | null
  /** 插入完成后回调（清除触发信号）。 */
  onInsertAtCursorConsumed: () => void
  /** Drop Zone TreeView 拖入的图片 → 加入 images state（模拟粘贴效果）。 */
  pendingImages: { seq: number; images: ImageAttachmentInput[] } | null
  /** 图片添加完成后回调（清除触发信号）。 */
  onPendingImagesConsumed: () => void
  /** / 命令目录快照（契约跟随；null = 未知/加载中——绝不静默降级为普通文本）。 */
  commands: { available: boolean; items: CommandDescriptorView[] } | null
  /** / 菜单技能目录快照（skill.list；null = 未知/加载中；纯附加、不参与 commands 门槛）。 */
  skills: SkillsSnapshot | null
  onCommandOpen: () => void
  onCommandExecute: (line: string, images?: ImageAttachmentInput[]) => void
  /** 命令目录未知时保持草稿并重拉目录。 */
  onCommandRetry: () => void
  /** /model 弹出层 + 输入框下方席位共享的目录数据。 */
  models: SessionModelsView | null
  onModelOpen: () => void
  onModelSelect: (provider: string, model: string, effort?: string) => void
  /** 权限席位 + /permission 弹出选择器的投影数据（null = 能力缺席 → 席位隐藏）。 */
  permissions: PermissionSelectView | null
  /** /permission 弹出层选中预设（已过风险门）→ 提交 `/permission <preset>`（消费输入框内
   *  的 `/permission` token，清空草稿）。 */
  onPermissionSelect: (preset: string) => void
  /** 输入框下方常驻权限席位选中预设 → 提交 `/permission <preset>`，但保留草稿：
   *  席位切换与用户正在输入的内容无关，不应清空输入框。 */
  onPermissionSeatSelect: (preset: string) => void
  /** /permission 弹出层打开 → 解析会话并加载投影（空/未绑定会话可用）。 */
  onPermissionOpen: () => void
  /** Agent Preset roster + stage state for this composer slot. */
  agentPresets: AgentPresetSelectView | null
  /** Bound Session summary; absent for the unbound slot or while its row loads. */
  agentPresetSession: SessionSummary | undefined
  agentPresetBound: boolean
  onAgentPresetOpen: () => void
  onAgentPresetSelect: (id: string) => void
  /** 命令准入即时反馈（composer 内提示）。 */
  notices: { level: 'info' | 'error'; text: string; id: number }[]
  onNoticeDismissed: (id: number) => void
  /** M4b: 当前会话的 todo 计划条（null/[] = 不渲染）。 */
  todos: TodoItem[] | null
  /** 当前会话的用量统计（token/时间/context 四投影组合；null = 全缺席 → chip 隐藏）。 */
  stats: UsageStatsView | null
  running: boolean
  submitting: boolean
  modelSubmitting: boolean
  /** RPC unavailable: drafting remains enabled, service actions do not. */
  serviceDisabled: boolean
  disabled: boolean
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** 高亮 @ 引用 token 与（行首/空白后的）/ 命令 token（对齐 Cline 的 highlight 层）。 */
const highlightTokens = (value: string): string =>
  escapeHtml(value)
    .replace(/(^|\s)(@\S+)/gu, (_, pre: string, token: string) => `${pre}<mark class="mention-context-textarea-highlight">${token}</mark>`)
    .replace(/(^|\s)(\/[A-Za-z0-9_.-]+)/gu, (_, pre: string, token: string) => `${pre}<mark class="mention-context-textarea-highlight">${token}</mark>`)

/**
 * 输入区（对齐 Cline ChatTextArea）：透明 textarea + 底下的 @/ 高亮层 + 悬浮菜单。
 * M3b（ADR-0001）：@ 两级菜单（文件/问题）与 / 命令菜单在 webview 内呈现，共享
 * detectTrigger 触发检测；带 hint 命令走 claim（`/name ` 前缀 + 提示幽灵，guard
 * claimed 压制 `/` 放行 `@`）；/model 下钻 provider 分组 → 模型。Enter 在菜单打开时
 * 全部让位菜单语义、绝不发送消息。
 */
export function Composer({
  text,
  onTextChange,
  commitSeq,
  onSend,
  onCancel,
  onAtOpen,
  onAtResolve,
  atCandidates,
  atInsert,
  onAtInsertConsumed,
  activeFile,
  activeFileEnabled,
  onActiveFileToggle,
  insertAtCursor,
  onInsertAtCursorConsumed,
  pendingImages,
  onPendingImagesConsumed,
  commands,
  skills,
  onCommandOpen,
  onCommandExecute,
  onCommandRetry,
  models,
  onModelOpen,
  onModelSelect,
  permissions,
  onPermissionSelect,
  onPermissionSeatSelect,
  onPermissionOpen,
  agentPresets,
  agentPresetSession,
  agentPresetBound,
  onAgentPresetOpen,
  onAgentPresetSelect,
  notices,
  onNoticeDismissed,
  todos,
  stats,
  running,
  submitting,
  modelSubmitting,
  serviceDisabled,
  disabled,
}: ComposerProps) {
  const { t } = useTranslation()
  const setText = onTextChange
  const [focused, setFocused] = useState(false)
  const [menu, setMenu] = useState<MenuState>(initialMenuState)
  /** 粘贴的图片附件（base64 + 缩略图 object URL）。 */
  const [images, setImages] = useState<Array<ImageAttachmentInput & { thumbUrl: string }>>([])
  /** 命令 claim（`/name ` 前缀 + hint 幽灵；guard 层级切到 claimed）。 */
  const [claim, setClaim] = useState<{ token: string; hint: string } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingCursorRef = useRef<number | null>(null)
  /** 菜单打开态（同步判断用；menu state 更新是异步的）。 */
  const menuOpenRef = useRef(false)
  /** IME 组合输入中（触发检测让路，防中文输入法误开菜单）。 */
  const composingRef = useRef(false)
  /** 菜单选中待插入的触发 span（atInsert 异步到达后替换用）。 */
  const pendingInsertRef = useRef<{ span: { start: number; end: number } } | null>(null)

  // routable=false：输入框 inert（模型目录快照里 host 报告当前路由无 adapter 服务）。
  const routableBlocked = models?.routable === false
  // 会话运行锁放宽：运行期间仍允许输入编辑（打字 + @ 引用），但发送与 / 命令、模型、权限
  // 等会话动作仍冻结。故 inputDisabled 不再含 running/submitting；running 改在 guard 层压制 / 触发，
  // submitting 仅在按钮 disabled 与 send() 内部拦截（不冻结输入框编辑）。
  const inputDisabled = disabled || routableBlocked
  const presetSubmitting = agentPresets?.busy === true
  // running 期间 / 触发被压制（只保留 @ 引用），对齐「编辑允许、命令冻结」。
  const guardTier: TriggerGuardTier = inputDisabled ? 'frozen' : (running || claim || presetSubmitting) ? 'claimed' : 'plain'

  useEffect(() => {
    menuOpenRef.current = menu.open
  }, [menu.open])

  /** 高亮层：@/ 命令 token 画成透明文字 + 底色圆角；claim 空参时追加 hint 幽灵。 */
  const renderHighlights = useCallback((value: string): void => {
    const layer = highlightRef.current
    const ta = inputRef.current
    if (!layer || !ta) return
    let html = highlightTokens(value)
    if (claim && value === claim.token) {
      html += `<span class="slash-claim-hint">${escapeHtml(claim.hint)}</span>`
    }
    layer.innerHTML = html
    layer.scrollTop = ta.scrollTop
    layer.scrollLeft = ta.scrollLeft
  }, [claim])

  // text/claim 变化后重绘高亮层（程序化 setText 也会落层）。
  useEffect(() => {
    renderHighlights(text)
  }, [text, renderHighlights])

  const closeMenu = useCallback((): void => {
    setMenu((prev) => (prev.open ? menuReduce(prev, { type: 'close' }).state : prev))
  }, [])

  const clearDraft = (): void => {
    setText('')
    setClaim(null)
    pendingCursorRef.current = null
    pendingInsertRef.current = null
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setImages([])
  }

  const lastCommitRef = useRef(commitSeq)
  useEffect(() => {
    if (commitSeq === lastCommitRef.current) return
    lastCommitRef.current = commitSeq
    clearDraft()
    // clearDraft deliberately belongs to the accepted operation signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitSeq])

  /**
   * Enter 分派（菜单关闭时）：未知 /xyz 与带参数无 hint 命令 → 普通消息；
   * hint 命令（claim 提交，带参或不带）与裸已知命令 → commands/execute；
   * 裸 /model → 模型弹出层；命令面确认不可用（旧 dsh）→ 全部当普通文本（§7.2 降级）；
   * 目录未知（null）→ hold：保持草稿并重拉（绝不静默降级）。
   */
  const adjudicate = (line: string): 'send' | 'execute' | 'model' | 'permission' | 'hold' => {
    if (!line.startsWith('/')) return 'send'
    const ws = line.search(/\s/)
    const token = ws === -1 ? line : line.slice(0, ws)
    const name = token.slice(1)
    if (name === '') return 'send'
    if (commands === null) return 'hold'
    if (!commands.available) return 'send'
    if (name === 'model' && ws === -1) return 'model'
    // bare /permission（无参数）→ 弹出选择器；带参 /permission <preset> 仍走 execute。
    if (name === 'permission' && (ws === -1 || line.slice(ws).trim() === '')) return 'permission'
    const entry = commands.items.find((e) => e.name === name)
    if (!entry) return 'send'
    if (entry.hint !== undefined) return 'execute'
    return ws === -1 ? 'execute' : 'send'
  }

  const send = (gesture: ComposerSubmitGesture): void => {
    if (presetSubmitting || submitting) return
    const value = text.trim()
    if (!value) return
    const decision = adjudicate(value)
    if (decision === 'hold') {
      onCommandRetry() // 目录未就绪：保持草稿，重拉命令目录
      return
    }
    if (decision === 'send') {
      // 普通消息：手势透传，扩展侧按 running + busyEnter 解析 queue/steer；
      // 眼睛启用的自动附带文件随消息回传（拖入文件已作为 @ 引用插入输入文本）。
      const imageInputs = images.length > 0 ? images.map(({ thumbUrl: _, ...rest }) => rest) : undefined
      const attachments: string[] = []
      if (activeFile !== null && activeFileEnabled) attachments.push(activeFile.absolutePath)
      onSend(value, gesture, attachments, imageInputs)
      return
    }
    // 运行锁：/ 命令、/model、/permission 等会话动作在运行期间冻结（不经 busy-enter 路径）。
    if (running) return
    if (decision === 'execute') {
      const imageInputs = images.length > 0 ? images.map(({ thumbUrl: _, ...rest }) => rest) : undefined
      onCommandExecute(value, imageInputs)
    } else if (decision === 'model') {
      // 裸 /model → 打开模型弹出层（draft 保留 `/model`，选中后清空）。
      onModelOpen()
      setMenu((prev) => {
        const opened = menuReduce(prev, {
          type: 'open',
          kind: 'slash',
          span: { start: 0, end: value.length },
          position: 'leading',
        }).state
        return { ...opened, model: { group: 0, index: 0, loading: true, failed: false } }
      })
    } else {
      // 裸 /permission → 打开权限弹出层并按需加载投影（空/未绑定会话也可用）。
      onPermissionOpen()
      setMenu((prev) => {
        const opened = menuReduce(prev, {
          type: 'open',
          kind: 'slash',
          span: { start: 0, end: value.length },
          position: 'leading',
        }).state
        return { ...opened, permission: { index: 0, loading: true, failed: false } }
      })
    }
  }

  const resize = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  /** 触发检测 + 菜单同步：命中 → 打开/切换/更新（query + span）；未命中 → 关闭。
   *  IME 组合输入期间不检测（防中文输入法误开菜单）。 */
  const syncTrigger = (value: string, cursor: number): void => {
    if (composingRef.current) return
    const hit = detectTrigger(value, cursor, { tier: guardTier })
    if (!hit) {
      if (menuOpenRef.current) closeMenu()
      return
    }
    const kind = hit.trigger === '@' ? 'at' : 'slash'
    setMenu((prev) => {
      // 未打开，或触发字符换了（新 token，如 @ 菜单中另起 / token）→ 重开菜单。
      if (!prev.open || prev.kind !== kind) {
        return menuReduce(prev, {
          type: 'open',
          kind,
          span: hit.span,
          position: hit.position,
        }).state
      }
      return menuReduce(prev, {
        type: 'query',
        query: hit.query,
        span: hit.span,
        position: hit.position,
      }).state
    })
  }

  // M3b: @ 菜单打开 → 一次性枚举候选；/ 菜单打开 → 拉取命令目录。
  useEffect(() => {
    if (!menu.open) return
    if (menu.kind === 'at') onAtOpen()
    else onCommandOpen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open, menu.kind])

  // M3b: / 命令目录快照到达 → 填充菜单；命令面确认不可用 → 关闭 / 菜单（/ 当普通文本）；
  // 目录未知（null）→ 保持加载态。
  useEffect(() => {
    if (!menu.open || menu.kind !== 'slash') return
    if (commands === null) return
    if (!commands.available) {
      setMenu((prev) => (prev.open && prev.kind === 'slash' ? menuReduce(prev, { type: 'close' }).state : prev))
      return
    }
    setMenu((prev) =>
      prev.open && prev.kind === 'slash'
        ? menuReduce(prev, { type: 'commands', entries: commands.items }).state
        : prev,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, menu.open, menu.kind])

  // M3b+: / 菜单技能目录快照到达 → 合并进可见行；available=false/失败 → 空技能（不关闭菜单）。
  useEffect(() => {
    if (!menu.open || menu.kind !== 'slash') return
    if (skills === null) return
    setMenu((prev) =>
      prev.open && prev.kind === 'slash'
        ? menuReduce(prev, { type: 'skills', entries: skills.available ? skills.items : [] }).state
        : prev,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, menu.open, menu.kind])

  // M3b: @ 候选到达 → 填充菜单。
  useEffect(() => {
    if (!menu.open || menu.kind !== 'at') return
    if (atCandidates) {
      setMenu((prev) =>
        prev.open && prev.kind === 'at'
          ? menuReduce(prev, { type: 'candidates', candidates: atCandidates }).state
          : prev,
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atCandidates, menu.open, menu.kind])

  // M3b: /model 数据到达 → 填充弹出层。
  useEffect(() => {
    if (!menu.open || menu.kind !== 'slash' || !menu.model) return
    if (models) {
      setMenu((prev) =>
        prev.open && prev.kind === 'slash' && prev.model
          ? menuReduce(prev, { type: 'models', groups: models.groups }).state
          : prev,
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models])

  // 权限弹出层数据：permissions 投影 prop 到达（或弹出层打开）→ 填充预设列表。
  // 依赖 menu.permission 使每次打开都从当前 prop 重填（无 onModelOpen 式重拉）。
  useEffect(() => {
    if (!menu.open || menu.kind !== 'slash' || !menu.permission) return
    if (permissions) {
      setMenu((prev) =>
        prev.open && prev.kind === 'slash' && prev.permission
          ? menuReduce(prev, { type: 'permissions', value: permissions }).state
          : prev,
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions, menu.permission])

  // /permission 弹出层：投影宽限期后仍未到 → 标记失败（空/无权限能力的会话不卡「加载中…」）。
  useEffect(() => {
    if (!menu.open || menu.kind !== 'slash' || !menu.permission) return
    if (!menu.permission.loading) return
    if (permissions !== null) return
    const timer = setTimeout(() => {
      setMenu((prev) =>
        prev.open && prev.kind === 'slash' && prev.permission && prev.permission.loading
          ? menuReduce(prev, { type: 'permissionsFailed' }).state
          : prev,
      )
    }, 1500)
    return () => clearTimeout(timer)
  }, [menu.permission, permissions])

  // Drop Zone TreeView 拖入文件 → 在 textarea 光标处插入 @引用文本。
  // 用 seq 触发（即使路径相同也重新插入）；text 为空时跳过。
  useEffect(() => {
    if (!insertAtCursor || insertAtCursor.text === '') return
    onInsertAtCursorConsumed()
    const el = inputRef.current
    const insertText = insertAtCursor.text
    if (el) {
      const pos = el.selectionStart ?? text.length
      const end = el.selectionEnd ?? pos
      // 在光标处插入 @引用 + 尾随空格。
      const gap = end < text.length && text[end] !== ' ' ? ' ' : ''
      const inserted = `${insertText} `
      pendingCursorRef.current = pos + inserted.length
      setText(text.slice(0, pos) + inserted + gap + text.slice(end))
    } else {
      // textarea 未挂载时追加到末尾。
      const inserted = `${insertText} `
      pendingCursorRef.current = text.length + inserted.length
      setText(text + inserted)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertAtCursor?.seq])

  // Drop Zone TreeView 拖入图片 → 加入 images state（模拟粘贴效果）。
  // extension host 已读取图片为 base64，这里只需构造 data URL 作缩略图。
  useEffect(() => {
    if (!pendingImages || pendingImages.images.length === 0) return
    onPendingImagesConsumed()
    const newImages = pendingImages.images.map((img) => ({
      ...img,
      thumbUrl: `data:${img.mediaType};base64,${img.data}`,
    }))
    setImages((prev) => [...prev, ...newImages])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImages?.seq])

  // M3b: 扩展侧 @ 插入文本到达 → 替换触发 span（用户已改动则丢弃）。
  // 插入文本后跟一个分隔空格（insertionGap）：@ 引用/命令 token 由此成为独立词，
  // 光标之后的输入（含再次 @ 或 /）不再并入原 token，即退出命令态。
  useEffect(() => {
    if (atInsert === null) return
    onAtInsertConsumed()
    const pending = pendingInsertRef.current
    pendingInsertRef.current = null
    if (!pending) return
    const { span } = pending
    const slice = text.slice(span.start, span.end)
    if (!slice.startsWith('@') && !slice.startsWith('/')) return // 用户已编辑该 token
    const tail = text.slice(span.end)
    const gap = insertionGap(tail)
    const inserted = `${atInsert}${gap}`
    pendingCursorRef.current = span.start + inserted.length
    setText(text.slice(0, span.start) + inserted + tail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atInsert])

  // 插入后把光标落位到引用/claim 之后并聚焦（继续输入）。
  useEffect(() => {
    const el = inputRef.current
    if (!el || pendingCursorRef.current === null) return
    const pos = Math.min(pendingCursorRef.current, el.value.length)
    el.setSelectionRange(pos, pos)
    el.focus()
    pendingCursorRef.current = null
  }, [text])

  // claim 释放：draft 不再以 claim token 开头（用户编辑）→ guard 回 plain。
  useEffect(() => {
    if (claim && !text.startsWith(claim.token)) setClaim(null)
  }, [text, claim])

  /** 用替换文本替换触发 span（claim），并落位光标。 */
  const spliceClaim = (span: { start: number; end: number } | null, token: string, hint: string): void => {
    const start = span?.start ?? text.length
    const end = span?.end ?? start
    let tail = text.slice(end)
    if (tail.startsWith(' ')) tail = tail.slice(1)
    const next = text.slice(0, start) + token + tail
    pendingCursorRef.current = start + token.length
    setText(next)
    setClaim({ token, hint })
  }

  /** 菜单 Enter：执行菜单语义（插入引用 / claim / 执行 / 下钻），绝不发送消息；
   *  pass（无可选行）按 dsh 语义放行 Enter —— 目录未知时保持草稿重拉，否则关闭菜单回落发送。 */
  const handleMenuEnter = (): void => {
    const { state, outcome } = menuReduce(menu, { type: 'enter' })
    setMenu(state)
    if (outcome.kind === 'pass') {
      if (menu.kind === 'slash' && text.trim().startsWith('/') && commands === null) {
        onCommandRetry() // 目录加载中：保持草稿与菜单，重拉目录（不静默降级）
        return
      }
      closeMenu()
      send('enter')
      return
    }
    const span = menu.span ?? { start: 0, end: text.length }
    switch (outcome.kind) {
      case 'drill':
      case 'none':
        break // 状态迁移完成 / 无动作
      case 'insert-file':
        pendingInsertRef.current = { span }
        onAtResolve({ kind: 'file', absolutePath: outcome.candidate.absolutePath })
        break
      case 'insert-problem':
        pendingInsertRef.current = { span }
        onAtResolve({
          kind: 'problem',
          path: outcome.candidate.path,
          line: outcome.candidate.line,
          column: outcome.candidate.column,
          severity: outcome.candidate.severity,
          message: outcome.candidate.message,
        })
        break
      case 'claim':
        spliceClaim(menu.span, `/${outcome.entry.name} `, outcome.entry.hint ?? '')
        break
      case 'insert-skill': {
        // 选中技能 → 落 `/name ` 纯文本（无 hint 幽灵、guard 保持 plain），用户继续输参、
        // Enter 走 session.prompt（对齐 web GUI ui-skill 的 plain-text-reference）。
        const span = menu.span ?? { start: 0, end: text.length }
        let tail = text.slice(span.end)
        if (tail.startsWith(' ')) tail = tail.slice(1)
        const token = `/${outcome.entry.name} `
        pendingCursorRef.current = span.start + token.length
        setText(text.slice(0, span.start) + token + tail)
        break
      }
      case 'execute': {
        // 执行触发 token 本身（inline 前缀保留，对齐 consume-token 语义）。
        if (running || presetSubmitting) break // 运行/模式写入锁：命令执行冻结
        const span = menu.span ?? { start: 0, end: text.length }
        const line = text.slice(span.start, span.end).trim()
        if (line) {
          const imageInputs = images.length > 0 ? images.map(({ thumbUrl: _, ...rest }) => rest) : undefined
          onCommandExecute(line, imageInputs)
        }
        break
      }
      case 'model-drill':
        if (presetSubmitting) break
        onModelOpen()
        break
      case 'select-model':
        if (!running && !presetSubmitting) onModelSelect(outcome.provider, outcome.model.id)
        break
      case 'permission-drill':
        if (presetSubmitting) break
        onPermissionOpen() // 状态迁移已在 menuReduce 完成；这里按需重拉投影（空/未绑定会话可用）。
        break
      case 'select-permission':
        if (!running && !presetSubmitting) onPermissionSelect(outcome.preset)
        break
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    const cursor = e.target.selectionStart ?? value.length
    setText(value)
    resize(e.target)
    syncTrigger(value, cursor)
  }

  /** IME 组合结束：补一次触发检测（组合期间的输入可能已构成触发）。 */
  const handleCompositionEnd = (): void => {
    composingRef.current = false
    const el = inputRef.current
    if (el) syncTrigger(el.value, el.selectionStart ?? el.value.length)
  }

  /** 光标移动（点击/方向键）：不再命中触发 token → 菜单立即关闭。 */
  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget
    syncTrigger(el.value, el.selectionStart ?? el.value.length)
  }

  /** 粘贴图片：从剪贴板提取 image/png|jpeg|webp|gif，转 base64 + 缩略图。 */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageItems: DataTransferItem[] = []
    for (const item of items) {
      if (item.type.startsWith('image/')) imageItems.push(item)
    }
    if (imageItems.length === 0) return // 纯文本粘贴走默认流程
    e.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue
      addImageFiles([file])
    }
  }

  /** 移除指定索引的图片。 */
  const removeImage = (index: number): void => {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  /** 从 File 对象添加图片（文件选择器或拖放）。
   *  缩略图用 data URL（VS Code webview CSP 禁止 blob: URL）。 */
  const addImageFiles = (files: File[]): void => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = (): void => {
        const dataUrl = reader.result as string
        const commaIdx = dataUrl.indexOf(',')
        if (commaIdx === -1) return
        const base64 = dataUrl.slice(commaIdx + 1)
        setImages((prev) => [
          ...prev,
          {
            mediaType: file.type,
            data: base64,
            name: file.name || undefined,
            thumbUrl: dataUrl, // 直接用 data URL 作缩略图（CSP 允许）
          },
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // IME 组合输入期间按键全部放行（防中文输入法方向键/Enter 劫持，对齐 dsh arbitrate）。
    if (e.nativeEvent.isComposing) return
    if (menu.open) {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setMenu((prev) => menuReduce(prev, { type: 'move', dir: -1 }).state)
          return
        case 'ArrowDown':
          e.preventDefault()
          setMenu((prev) => menuReduce(prev, { type: 'move', dir: 1 }).state)
          return
        case 'Enter':
          e.preventDefault()
          handleMenuEnter()
          return
        case 'Escape':
          e.preventDefault()
          setMenu((prev) => menuReduce(prev, { type: 'escape' }).state)
          return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(e.ctrlKey || e.metaKey ? 'accelerated' : 'enter')
      return
    }
    // 空格 claim（对齐 dsh matchSpace）：行首 `/name` 后按空格 → `/name ` + hint。
    if (e.key === ' ' && !e.shiftKey && !menu.open && !claim && !running && !presetSubmitting && commands?.available === true) {
      const caret = e.currentTarget.selectionStart ?? text.length
      const leading = text.slice(0, caret)
      const ws = leading.search(/\s/)
      const token = ws === -1 ? leading : leading.slice(0, ws)
      if (token.startsWith('/') && token.length > 1 && text.slice(caret) === '') {
        const entry = commands.items.find((c) => c.name === token.slice(1))
        if (entry?.hint !== undefined) {
          e.preventDefault()
          spliceClaim({ start: 0, end: caret }, `${token} `, entry.hint)
        }
      }
    }
  }

  const handleBlur = (): void => {
    setFocused(false)
    // 指针点到菜单外 → 关闭菜单（菜单自身用 onMouseDown preventDefault 保持焦点）。
    setTimeout(() => {
      const active = document.activeElement
      if (!menuRef.current?.contains(active as Node)) closeMenu()
    }, 0)
  }

  const menuRows = (): React.ReactNode => {
    if (menu.kind === 'at') {
      if (!menu.atDrill) {
        return (
          <>
            {(['files', 'problems'] as const).map((cat, i) => (
              <MenuRow key={cat} selected={menu.index === i} title={cat === 'files' ? t('composer.placeholderFiles') : t('composer.placeholderProblems')}>
                <span className="text-xs text-description">
                  {cat === 'files'
                    ? t('composer.filesCount', { count: menu.candidates.files.length })
                    : t('composer.problemsCount', { count: menu.candidates.problems.length })}
                </span>
              </MenuRow>
            ))}
          </>
        )
      }
      const items = visibleAtItems(menu)
      if (menu.loading) return <MenuLoading />
      if (menu.failed) return <MenuFailed />
      if (items.length === 0) {
        return <MenuRow title={menu.atCategory === 'files' ? t('composer.noMatchingFiles') : t('composer.noMatchingProblems')} selected={false} />
      }
      if (menu.atCategory === 'files') {
        return items.map((item, i) => {
          const file = item as { relativePath: string; pinned: boolean; dirty: boolean }
          return (
            <MenuRow key={file.relativePath} selected={menu.index === i} title={file.relativePath}>
              {file.pinned ? <span className="text-xs text-description">{t('composer.currentFile')}</span> : null}
              {file.dirty ? <span className="text-xs text-warning">{t('composer.unsaved')}</span> : null}
            </MenuRow>
          )
        })
      }
      return items.map((item, i) => {
        const problem = item as { path: string; line: number; column: number; severity: string; message: string }
        return (
          <MenuRow
            key={`${problem.path}:${problem.line}:${problem.column}`}
            selected={menu.index === i}
            title={problem.message}
          >
            <span className={`text-xs ${severityClass(problem.severity)}`}>
              {problem.path}:{problem.line}:{problem.column}
            </span>
          </MenuRow>
        )
      })
    }
    // / 菜单
    if (menu.model) {
      const group = currentModelGroup(menu)
      if (menu.model.loading) return <MenuLoading />
      if (menu.model.failed) return <MenuFailed />
      if (!group) return <MenuRow title={t('composer.noModels')} selected={false} />
      return (
        <>
          <MenuRow title={group.name} selected={false} muted />
          {group.models.map((m, i) => (
            <MenuRow key={m.id} selected={menu.index === i} title={m.name}>
              <span className="text-xs text-description">{m.id}</span>
            </MenuRow>
          ))}
        </>
      )
    }
    if (menu.permission) {
      if (menu.permission.loading) return <MenuLoading />
      if (menu.permission.failed) return <MenuRow title={t('composer.permissionUnavailable')} selected={false} />
      const options = permissionOptions(menu)
      if (options.length === 0) return <MenuRow title={t('composer.noPermissionPresets')} selected={false} />
      return options.map((option, i) => {
        const selected = menu.permissions?.currentValue === option.value
        const label = permissionLabel(option.value, option.name)
        return (
          <MenuRow key={option.value} selected={menu.index === i} title={label}>
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-xs text-description" title={option.description}>
                {option.description ?? ''}
              </span>
              {selected ? <IconCheckOutline16 size={16} /> : null}
            </span>
          </MenuRow>
        )
      })
    }
    const rows = visibleCommandRows(menu)
    if (menu.loading) return <MenuLoading />
    if (menu.failed) return <MenuFailed />
    if (rows.length === 0) return <MenuRow title={t('composer.noMatchingCommands')} selected={false} />
    // 命令行描述走中文本地化；技能行显示描述原文，仅用户技能加「仅用户 · 」前缀（对齐 dsh）。
    // 名字完整可见（不截断、过长换行）；描述单行截断，hover 显示全文（原生 title）。
    return rows.map((row, i) => {
      const description = menuRowDescription(row, t)
      return (
        <MenuRow key={row.name} selected={menu.index === i} title={`/${row.name}`} wrapTitle>
          <span className="min-w-0 flex-1 truncate text-xs text-description" title={description}>
            {description}
          </span>
        </MenuRow>
      )
    })
  }

  return (
    <div className="flex-none">
      {/* M4b: todo 计划条（composer 输入区顶部；对齐 dsh web input dock 位置）。 */}
      <TodoStrip todos={todos} />
      <div className="relative px-3.5 py-2.5">
        {/* 悬浮菜单：锚定在输入盒上方（@/ 触发后呼出）。 */}
        {menu.open && (
          <div
            ref={menuRef}
            className="absolute bottom-full left-3.5 right-3.5 z-20 mb-1 overflow-hidden rounded-xs border border-border-panel bg-background shadow-lg"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="max-h-[240px] overflow-y-auto py-1">{menuRows()}</div>
          </div>
        )}
        {/* 输入盒容器：textarea + 高亮层 + 内嵌底部工具栏（Codex 风格）。 */}
        <div
          className={`relative flex flex-col rounded-lg bg-input-background composer-glow ${focused ? 'composer-glow-focused' : ''}`}
        >
          {/* 高亮层：@/ 命令 token 画成透明文字 + 底色圆角。 */}
          <div
            ref={highlightRef}
            aria-hidden
            className="absolute top-0 left-0 right-0 overflow-hidden whitespace-pre-wrap break-words"
            style={{
              color: 'transparent',
              fontFamily: 'var(--vscode-font-family)',
              fontSize: 'var(--text-sm)',
              lineHeight: 'var(--vscode-editor-line-height)',
              padding: '9px 9px 9px 9px',
            }}
          />
          <textarea
            ref={inputRef}
            rows={2}
            value={text}
            disabled={inputDisabled}
            onChange={handleChange}
            onSelect={handleSelect}
            onScroll={(e) => {
              const layer = highlightRef.current
              if (layer) {
                layer.scrollTop = e.currentTarget.scrollTop
                layer.scrollLeft = e.currentTarget.scrollLeft
              }
            }}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={handleCompositionEnd}
            className="z-1 w-full flex-1 resize-none overflow-x-hidden overflow-y-scroll bg-transparent text-input-foreground outline-none focus:outline-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden disabled:opacity-60"
            style={{
              fontFamily: 'var(--vscode-font-family)',
              fontSize: 'var(--text-sm)',
              lineHeight: 'var(--vscode-editor-line-height)',
              padding: '9px 9px 9px 9px',
              border: 0,
              cursor: 'text',
            }}
          />
          {/* 粘贴图片预览条（textarea 与工具栏之间）。 */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2 pt-1">
              {images.map((img, i) => (
                <div key={i} className="group relative">
                  <img
                    src={img.thumbUrl}
                    alt={img.name ?? `image-${i + 1}`}
                    className="h-10 w-10 rounded-xs border border-border-panel object-cover"
                  />
                  <button
                    type="button"
                    className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-background text-description hover:text-error opacity-0 transition-opacity group-hover:opacity-100"
                    title={t('common.remove')}
                    onClick={() => removeImage(i)}
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* 底部工具栏（输入框内）：左侧 = + 图片上传 + 权限席位 + 自动附带文件；
              右侧 = 模式 + 模型 + UsageChip + 发送/停止圆形按钮。 */}
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5">
            {/* 左侧：图片上传圆形 + 按钮（隐藏 file input） */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files
                if (files) addImageFiles(Array.from(files))
                e.target.value = '' // 允许重复选同一文件
              }}
            />
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-full text-description hover:bg-list-hover hover:text-foreground"
              title={t('composer.attachImage')}
              disabled={inputDisabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            {/* 权限席位（工作区写入） */}
            <PermissionSelect
              value={permissions}
              onSelect={onPermissionSeatSelect}
              disabled={disabled || running || submitting || modelSubmitting || presetSubmitting || serviceDisabled}
            />
            {/* 自动附带文件条（内嵌，紧凑样式） */}
            {activeFile !== null && (
              <div
                className={`flex max-w-[200px] items-center gap-1 rounded-xs border px-1.5 py-0.5 ${
                  activeFileEnabled
                    ? 'border-input-border bg-transparent'
                    : 'border-input-border bg-transparent opacity-60'
                }`}
                title={activeFile.absolutePath}
              >
                <button
                  type="button"
                  onClick={() => onActiveFileToggle(!activeFileEnabled)}
                  className={`input-icon-button flex size-4 shrink-0 items-center justify-center rounded-xs ${
                    activeFileEnabled ? 'text-input-foreground' : 'text-description'
                  }`}
                  title={
                    activeFileEnabled
                      ? t('composer.activeFileEnabledTitle')
                      : t('composer.activeFileDisabledTitle')
                  }
                  aria-pressed={activeFileEnabled}
                >
                  {activeFileEnabled ? <IconEyeOutline16 size={14} /> : <IconEyeOffOutline16 size={14} />}
                </button>
                <span
                  className={`truncate text-xs ${activeFileEnabled ? 'text-input-foreground' : 'text-description'}`}
                >
                  {activeFile.relativePath}
                </span>
                {activeFile.dirty ? (
                  <span className="shrink-0 text-xs text-warning" title={t('composer.activeFileDirtyTitle')}>
                    ●
                  </span>
                ) : null}
              </div>
            )}
            {/* 右侧：模式 + 模型 + UsageChip + 发送按钮 */}
            <div className="ml-auto flex items-center gap-1.5">
              <UsageChip stats={stats} />
              <AgentPresetSelect
                value={agentPresets}
                session={agentPresetSession}
                bound={agentPresetBound}
                onOpen={onAgentPresetOpen}
                onSelect={onAgentPresetSelect}
                disabled={disabled || running || submitting || modelSubmitting || serviceDisabled}
              />
              <ModelSelect
                models={models}
                onOpen={onModelOpen}
                onSelect={onModelSelect}
                disabled={disabled || running || submitting || modelSubmitting || presetSubmitting || serviceDisabled}
              />
              {running || submitting ? (
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-full bg-error text-background hover:opacity-90"
                  title={t('common.stop')}
                  onClick={onCancel}
                >
                  <IconStopFill16 size={13} />
                </button>
              ) : (
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-full bg-button-background text-button-foreground hover:bg-button-hover disabled:opacity-40"
                  title={t('common.send')}
                  disabled={inputDisabled || submitting || serviceDisabled || modelSubmitting || presetSubmitting || text.trim().length === 0}
                  onClick={() => send('enter')}
                >
                  <IconSendOutline16 size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* 命令准入即时反馈（不进对话流）。 */}
      {notices.length > 0 && (
        <div className="px-3.5 pb-1">
          {notices.map((n) => (
            <div
              key={n.id}
              className={`mb-1 flex items-start justify-between gap-2 rounded-xs px-2 py-1 text-xs ${n.level === 'error' ? 'bg-error/10 text-error' : 'bg-muted/40 text-description'
                }`}
            >
              <span className="min-w-0 break-words">{n.text}</span>
              <button
                type="button"
                className="input-icon-button shrink-0 text-description"
                onClick={() => onNoticeDismissed(n.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- 菜单行子组件 ----

function MenuRow({
  title,
  selected,
  muted,
  wrapTitle,
  children,
}: {
  title: string
  selected: boolean
  muted?: boolean
  wrapTitle?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      className={`flex min-w-0 items-center justify-between gap-2 px-2.5 py-1.5 ${selected ? 'bg-selection text-selection-foreground' : muted ? 'bg-transparent' : 'hover:bg-list-hover'
        }`}
    >
      <span className={`text-sm ${wrapTitle ? 'min-w-0 break-all' : 'truncate'} ${muted ? 'text-description' : ''}`}>
        {title}
      </span>
      {children}
    </div>
  )
}

function MenuLoading() {
  const { t } = useTranslation()
  return <div className="px-2.5 py-1.5 text-xs text-description">{t('common.loading')}</div>
}

function MenuFailed() {
  const { t } = useTranslation()
  return <div className="px-2.5 py-1.5 text-xs text-error">{t('composer.candidatesFailed')}</div>
}

/** / 菜单行描述：命令走中文本地化；技能显示描述原文，仅用户技能加「仅用户 · 」前缀。 */
function menuRowDescription(row: MenuEntry, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (row.kind === 'skill') {
    return row.modelInvocable ? row.description : t('composer.skillUserOnly', { description: row.description })
  }
  return commandDescription(row)
}

function severityClass(severity: string): string {
  switch (severity) {
    case 'error':
      return 'text-error'
    case 'warning':
      return 'text-warning'
    case 'info':
      return 'text-info'
    default:
      return 'text-description'
  }
}
