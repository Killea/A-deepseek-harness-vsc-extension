/**
 * / 命令描述的客户端本地化（对齐 dsh 术语）。wire 的 commands/list 描述为英文
 * 原文且无服务端 i18n；未知命令（未来 dsh 版本新增）回退 wire 原文，契约跟随。
 *
 * 使用 i18n 实例（非 React hook）以便在非组件上下文中调用。
 */

import i18n from "./i18n.ts";
import type { CommandDescriptorView } from "../../src/shared/protocol.ts";

/** 取命令的本地化描述；无对应翻译时回退 wire 原文。 */
export function commandDescription(entry: CommandDescriptorView): string {
  const translated = i18n.t(`command.${entry.name}`);
  // i18next returns the key itself when missing; fall back to wire description.
  return translated === `command.${entry.name}` ? entry.description : translated;
}
