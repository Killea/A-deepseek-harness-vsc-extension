/**
 * Locale resource bundle: imports all .jsonc translation files and exports
 * them keyed by locale code. Vite's jsonc plugin strips comments at build
 * time (webview); esbuild's `.jsonc` loader does the same (host).
 *
 * Add a new locale by:
 *   1. Creating `<code>.jsonc` in this directory (same keys as `en.jsonc`).
 *   2. Adding it to `resources` below and to SUPPORTED_LOCALES.
 */

import en from "./en.jsonc";
import zhCn from "./zh-cn.jsonc";
import zhTw from "./zh-tw.jsonc";
import ja from "./ja.jsonc";
import de from "./de.jsonc";
import fr from "./fr.jsonc";
import es from "./es.jsonc";

/** All locale codes the extension ships translations for. */
export const SUPPORTED_LOCALES = [
  "en",
  "zh-cn",
  "zh-tw",
  "ja",
  "de",
  "fr",
  "es",
] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

/** Native display names for each locale (shown in the language dropdown). */
export const LOCALE_NATIVE_NAMES: Record<LocaleCode, string> = {
  "en": "English",
  "zh-cn": "简体中文",
  "zh-tw": "繁體中文",
  "ja": "日本語",
  "de": "Deutsch",
  "fr": "Français",
  "es": "Español",
};

/** Default locale when vscode.env.language is unsupported or unset. */
export const DEFAULT_LOCALE: LocaleCode = "en";

/**
 * Map a VS Code display language (e.g. "zh-cn", "zh-tw", "ja", "de", "fr",
 * "es", "en") to a supported locale code. Returns DEFAULT_LOCALE for
 * unsupported or undefined input.
 */
export function resolveLocale(vscodeLanguage: string | undefined): LocaleCode {
  if (vscodeLanguage === undefined) return DEFAULT_LOCALE;
  const normalized = vscodeLanguage.toLowerCase();
  if ((SUPPORTED_LOCALES as readonly string[]).includes(normalized)) {
    return normalized as LocaleCode;
  }
  // VS Code uses "zh-cn" / "zh-tw"; accept bare "zh" → zh-cn as a convenience.
  if (normalized === "zh") return "zh-cn";
  return DEFAULT_LOCALE;
}

/**
 * Translation resources keyed by locale code (i18next `resources` shape).
 * All 7 locales are bundled here.
 */
export const resources: Partial<Record<LocaleCode, { translation: Record<string, unknown> }>> = {
  en: { translation: en as Record<string, unknown> },
  "zh-cn": { translation: zhCn as Record<string, unknown> },
  "zh-tw": { translation: zhTw as Record<string, unknown> },
  ja: { translation: ja as Record<string, unknown> },
  de: { translation: de as Record<string, unknown> },
  fr: { translation: fr as Record<string, unknown> },
  es: { translation: es as Record<string, unknown> },
};

/**
 * Load a locale's translation resource. Returns the English bundle for
 * unsupported codes (i18next also falls back via `fallbackLng: "en"`).
 */
export function loadResource(code: string): Record<string, unknown> {
  const bundle = resources[code as LocaleCode];
  return bundle ? bundle.translation : resources[DEFAULT_LOCALE]!.translation;
}
