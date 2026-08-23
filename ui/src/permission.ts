/**
 * 权限预设的显示标签（客户端本地化）：已知机器键 → 本地化标签；未知 host 预设
 * 回退 title-case（workspace-write → Workspace Write），非 kebab 名原样。
 * 席位、弹出选择器、设置默认行三处共用，保证同一机器键在同一标签下呈现。
 *
 * 使用 i18n 实例（非 React hook）以便在非组件上下文中调用。
 */

import i18n from "./i18n.ts";

/** 需要显式风险确认门的预设机器键。 */
export const FULL_ACCESS_PRESET = "danger-full-access";

/** 机器键 → i18n key 映射（不在 locale 文件中的键回退 title-case）。 */
const PRESET_I18N_KEYS: Record<string, string> = {
  "workspace-write": "permission.workspaceWrite",
  "read-only": "permission.readOnly",
  [FULL_ACCESS_PRESET]: "permission.fullAccess",
  custom: "permission.customLabel",
};

/** kebab-case 机器名 → title-case；非 kebab 名原样返回。 */
function titleCase(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name;
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** 取一个权限预设的显示标签（value = 机器键；name = host 提供的 name 标签）。 */
export function permissionLabel(value: string, name: string): string {
  const i18nKey = PRESET_I18N_KEYS[value];
  if (i18nKey !== undefined) {
    const translated = i18n.t(i18nKey);
    if (translated !== i18nKey) return translated;
  }
  return titleCase(name);
}
