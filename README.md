<img src="https://raw.githubusercontent.com/Killea/A-deepseek-harness-vsc-extension/main/ui/src/deepseek-color.svg" width="64" align="left" alt="DeepSeek Gold Harness" />

# DeepSeek Gold Harness — VS Code Extension

> [!NOTE]
> This is a **community** project. It may have issues, and we are actively working to make it better.

A **Visual Studio Code extension** that brings [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) into your editor with a native VS Code experience.

![Installs](https://vsmarketplacebadges.dev/installs-short/Killea.deepseek-gold-harness.svg) ![GitHub License](https://img.shields.io/github/license/Killea/A-deepseek-harness-vsc-extension) ![GitHub commit activity](https://img.shields.io/github/commit-activity/w/Killea/A-deepseek-harness-vsc-extension)

## Features

- **Native VS Code UI** — sidebar chat panel that follows your theme (light/dark/high-contrast)
- **File picker** — `@`-mention files from your workspace as conversation context
- **Editor awareness** — automatically attaches the active file and editor problems
- **Agent Preset selector** — switch between modes (Standard, PTC, Minimal, Creative) for blank sessions
- **Model & reasoning level selector** — Codex-style single-panel dropdown for quick model and reasoning effort switching
- **Session statistics tooltip** — hover the context-occupancy ring to see token usage, timing, and context breakdown
- **Todo strip** — live task tracking displayed above the composer
- **Pending dialog** — approval/plan-review/question flows with keyboard navigation
- **Multi-language support** — 7 languages with instant switching (see below)

## Multi-language Support (i18n)

The extension UI is fully internationalized using `i18next` + `react-i18next`. Supported languages:

| Code | Native Name |
|------|-------------|
| `en` | English |
| `zh-cn` | 简体中文 |
| `zh-tw` | 繁體中文 |
| `ja` | 日本語 |
| `de` | Deutsch |
| `fr` | Français |
| `es` | Español |

Language can be changed at any time via **Settings → Language** tab. The switch is **instant** — no window reload required. The language tab uses native names and a globe icon so users can always find it regardless of the current display language.

Both the webview UI and the extension host (VS Code commands, configuration descriptions, notifications) are localized. VS Code `package.nls.*.json` files are generated from `src/shared/nls/` during build.

## Install

### Visual Studio Marketplace

[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Killea.deepseek-gold-harness)

### Download or Build VSIX

[GitHub Releases](https://github.com/Killea/A-deepseek-harness-vsc-extension/releases)

[GitHub Repo](https://github.com/Killea/A-deepseek-harness-vsc-extension)

## Getting Started

The extension automatically discovers `dsh`. Install it first:

```bash
npm install -g @deepseek-ai/dsh
# or
npx @deepseek-ai/dsh
```

> [!NOTE]
> Due to possible breaking changes in DeepSeek Harness, this extension may only work with specific versions of dsh.
>
> Tested version: 0.1.0-rc.6

## Recent Changes

### UI & Design

- **Rounded corners (Codex style)** — all panels, menus, cards, buttons, and tooltips now use 8px border radius for a softer, modern look
- **Composer input field** — rounded with a blue glow border on focus
- **Session statistics** — changed from click-to-open modal to hover tooltip (no click required)
- **Model selector** — redesigned as a Codex-style single-panel dropdown: reasoning levels are always visible at the top, model list expands inline below an HR divider

### Internationalization

- Full i18n for all user-visible strings across webview and host
- 7 locale bundles (`en`, `zh-cn`, `zh-tw`, `ja`, `de`, `fr`, `es`) as JSONC files in `src/shared/locales/`
- Instant language switching via `i18n.changeLanguage()` + React `key` remount to bypass memoized components
- Fixed `Intl.getCanonicalLocales` uppercasing issue (`zh-cn` → `zh-CN`) by enabling `lowerCaseLng: true`
- Agent Preset names mapped by host-provided Chinese names (e.g. "极简模式" → "Minimal") so they translate correctly in all languages
- Language selector moved to its own Settings tab with a globe icon and native-language labels

### Settings

- **Settings page** — four tabs: Models, General, Language, About
- **Language tab** — independent tab with native-name button list (not a dropdown) so users never get lost after switching
- **Tab state persistence** — settings tab selection survives language-change remounts

### Build System

- `package.nls.*.json` files moved from root to `src/shared/nls/` (source of truth); build step copies them to root for VS Code
- Root nls files are gitignored build artifacts
- esbuild plugin strips JSONC comments for host-side locale bundling

## Roadmap

- [x] Usage display (token, context, timing)
- [x] Context occupancy breakdown
- [x] Agent preset selector (Standard, PTC, Minimal, Creative)
- [x] Multi-language i18n with instant switching
- [x] Codex-style model/reasoning selector
- [x] Hover tooltip for session statistics
- [ ] Session fork
- [ ] Changes list (artifact diff)
- [ ] SubAgent management
- [ ] Plugin management
- [ ] Real cost time (timestamp-based instead of interface timer)

## Development

```bash
pnpm i

# Debug
pnpm build
F5

# Package (output VSIX)
pnpm package
```

### Project Structure

```
src/
├── extension.ts              # Extension host entry point
├── services/                 # Host-side services (i18n, settings, agent-preset, etc.)
├── shared/
│   ├── locales/              # JSONC translation bundles (7 languages)
│   ├── nls/                  # package.nls.*.json source files
│   └── protocol.ts           # Shared types between host and webview
├── dsh/                      # DSH wire protocol client
└── webview/                  # Webview provider
ui/
├── src/
│   ├── App.tsx               # Root webview component
│   ├── i18n.ts               # i18next initialization
│   ├── components/           # React components (Composer, ChatArea, SessionList, etc.)
│   └── markdown/             # Markdown rendering pipeline
└── icons/                    # SVG icon components
```

## License

MIT

## Acknowledgements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [i18next](https://www.i18next.com/) / [react-i18next](https://react.i18next.com/)

## Credits

This project is a fork of [weinibuliu/deepseek-harness-vsc-extension](https://github.com/weinibuliu/deepseek-harness-vsc-extension), originally created by **weinibuliu**. The fork is maintained by **Killea** with additional features including multi-language i18n, Codex-style UI redesign, image paste support, and more.
