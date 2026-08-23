/**
 * Host-side i18n service: mirrors the webview's locale bundle so the
 * extension host (extension.ts / chat-view.ts) can localize user-facing
 * strings shown via vscode.window.showInformationMessage / showErrorMessage /
 * showInputBox / showOpenDialog.
 *
 * The active locale is resolved from (in priority order):
 *   1. The `killea.dsh-vsc.locale` setting (manual override).
 *   2. `vscode.env.language` (VS Code display language).
 *   3. `DEFAULT_LOCALE` ("en").
 *
 * The host does NOT use react-i18next (no React); it uses a plain `t()`
 * function backed by the same JSONC resources the webview bundles. This
 * keeps the two sides in sync without a runtime IPC round-trip per string.
 */

import * as vscode from "vscode";
import {
  DEFAULT_LOCALE,
  resolveLocale,
  resources,
  type LocaleCode,
} from "../shared/locales/index.ts";

/** Configuration section for the extension's settings. */
const CONFIG_SECTION = "killea.dsh-vsc";

/** Setting key for the manual locale override. */
const LOCALE_SETTING = "locale";

/** Flat translation map per locale (namespace.key → string). */
type FlatBundle = Record<string, string>;

/**
 * Host-side i18n: a lightweight `t(key, params?)` translator backed by the
 * same JSONC resources the webview uses. Re-resolves the active locale on
 * each config change so a setting update is picked up without a restart.
 */
export class I18nService {
  private locale: LocaleCode;
  private readonly flat: Partial<Record<LocaleCode, FlatBundle>>;

  constructor() {
    this.locale = this.resolveActiveLocale();
    this.flat = this.flatten(resources);
  }

  /** Current active locale code. */
  get currentLocale(): LocaleCode {
    return this.locale;
  }

  /**
   * Translate a dotted key (e.g. "host.dshNotReady") with optional
   * interpolation params. Falls back to English if the key is missing in
   * the active locale, then to the key itself if missing everywhere.
   */
  t(key: string, params?: Record<string, string | number>): string {
    const raw =
      this.flat[this.locale]?.[key] ??
      this.flat[DEFAULT_LOCALE]?.[key] ??
      key;
    return this.interpolate(raw, params);
  }

  /**
   * Re-resolve the active locale from settings / VS Code language.
   * Called when the `locale` setting changes.
   */
  refresh(): void {
    this.locale = this.resolveActiveLocale();
  }

  /**
   * Force-set the active locale without re-reading config. Used by
   * `serveSelectLocale` to avoid a race where `config.update` hasn't
   * fully propagated by the time `refresh()` reads it.
   */
  setLocale(locale: LocaleCode): void {
    this.locale = locale;
  }

  /**
   * Resolve a raw config value (string | null) to a LocaleCode,
   * matching the internal resolution logic. Exposed so callers
   * that already have the raw value can resolve without re-reading.
   */
  resolveFromValue(value: string | null): LocaleCode {
    if (value !== null && value.trim() !== "") {
      return resolveLocale(value);
    }
    return resolveLocale(vscode.env.language);
  }

  // ---- internals ----

  private resolveActiveLocale(): LocaleCode {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const override = config.get<string | null>(LOCALE_SETTING, null);
    if (override !== null && override.trim() !== "") {
      return resolveLocale(override);
    }
    return resolveLocale(vscode.env.language);
  }

  /**
   * Flatten the nested resource bundle (namespace → key → string) into
   * dotted keys ("namespace.key") for O(1) lookup.
   */
  private flatten(
    bundle: Partial<Record<LocaleCode, { translation: Record<string, unknown> }>>,
  ): Partial<Record<LocaleCode, FlatBundle>> {
    const out: Partial<Record<LocaleCode, FlatBundle>> = {};
    for (const code of Object.keys(bundle) as LocaleCode[]) {
      const entry = bundle[code];
      if (entry === undefined) continue;
      const translation = entry.translation;
      const flat: FlatBundle = {};
      for (const [ns, sub] of Object.entries(translation)) {
        if (typeof sub === "object" && sub !== null) {
          for (const [key, value] of Object.entries(sub as Record<string, unknown>)) {
            if (typeof value === "string") flat[`${ns}.${key}`] = value;
          }
        } else if (typeof sub === "string") {
          flat[ns] = sub;
        }
      }
      out[code] = flat;
    }
    return out;
  }

  /** Simple {{name}} interpolation (mirrors i18next's default). */
  private interpolate(
    template: string,
    params?: Record<string, string | number>,
  ): string {
    if (params === undefined) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      const v = params[name];
      return v === undefined ? "" : String(v);
    });
  }
}
