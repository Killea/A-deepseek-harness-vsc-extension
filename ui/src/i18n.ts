/**
 * Webview i18n initialization: configures i18next + react-i18next with the
 * bundled locale resources. The active language is set by the extension host
 * via a `locale` message (see App.tsx); on first load it defaults to the
 * browser/VS Code language until the host pushes the authoritative locale.
 *
 * `react-i18next`'s `useTranslation` hook re-renders components on language
 * change, so calling `i18n.changeLanguage(code)` from App.tsx is enough to
 * switch the entire webview.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_LOCALE,
  resources,
  type LocaleCode,
} from "../../src/shared/locales/index.ts";

void i18n.use(initReactI18next).init({
  resources: resources as Record<string, { translation: Record<string, unknown> }>,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  // i18next's formatLanguageCode uses Intl.getCanonicalLocales which normalizes
  // "zh-cn" → "zh-CN" (uppercase region). Our resource keys are lowercase
  // ("zh-cn", "zh-tw"), so enable lowerCaseLng to keep them matching.
  lowerCaseLng: true,
  // JSONC files are nested by feature namespace (e.g. { chat: { loadOlder: ... } });
  // use the default "." separator so t("chat.loadOlder") resolves correctly.
  keySeparator: ".",
  nsSeparator: false,
  interpolation: {
    // React already escapes; disable i18next's own escaping.
    escapeValue: false,
  },
  returnEmptyString: false,
});

export default i18n;
export type { LocaleCode };
export { resolveLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from "../../src/shared/locales/index.ts";

/**
 * Switch the webview language. Called from App.tsx when a `locale` message
 * arrives from the extension host. Accepts a string (the locale code from
 * the protocol message) and validates it against supported locales.
 */
export function setLocale(code: string): Promise<unknown> {
  return i18n.changeLanguage(code);
}
