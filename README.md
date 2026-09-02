<img src="https://raw.githubusercontent.com/Killea/A-deepseek-harness-vsc-extension/main/ui/src/deepseek-color.png" width="64" align="left" alt="DeepSeek Gold Harness" />

# DeepSeek Gold Harness — VS Code Extension

<!-- LATEST-RELEASE -->
> **Latest build: v0.1.86** — [Download VSIX](https://github.com/Killea/A-deepseek-harness-vsc-extension/releases/download/v0.1.86/deepseek-gold-harness-0.1.86.vsix)
<!-- /LATEST-RELEASE -->

> [!NOTE]
> This is a **community** project. It may have issues, and we are actively working to make it better.

A **Visual Studio Code extension** that brings [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) into your editor with a native VS Code experience.

![Installs](https://vsmarketplacebadges.dev/installs-short/AgentChatBus.deepseek-gold-harness.svg) ![GitHub License](https://img.shields.io/github/license/Killea/A-deepseek-harness-vsc-extension) ![GitHub commit activity](https://img.shields.io/github/commit-activity/w/Killea/A-deepseek-harness-vsc-extension)

![DeepSeek Gold Harness — Editor & Agent Preset modes](https://raw.githubusercontent.com/Killea/A-deepseek-harness-vsc-extension/main/gold.png)

## Features

- **Native VS Code UI** — sidebar chat panel that follows your theme (light/dark/high-contrast)
- **File picker** — `@`-mention files from your workspace as conversation context
- **Editor awareness** — automatically attaches the active file and editor problems
- **Agent Preset selector** — switch between modes (Standard, PTC, Minimal, Creative) for blank sessions
- **Model & reasoning level selector** — Codex-style single-panel dropdown for quick model and reasoning effort switching
- **Image paste support** — paste images directly from clipboard (PNG/JPEG/WebP/GIF) into the composer
- **Session statistics tooltip** — hover the context-occupancy ring to see token usage, timing, and context breakdown
- **Todo strip** — live task tracking displayed above the composer
- **Pending dialog** — approval/plan-review/question flows with keyboard navigation
- **Multi-language support** — 7 languages with instant switching (see below)

## Requirements

- **VS Code** ≥ 1.90.0
- **DeepSeek Harness (`dsh`)** — the extension discovers and manages the `dsh` runtime for you; install it first (see [Getting Started](#getting-started))
- **Node.js** ≥ 20 (required by `dsh`)

## Getting Started

1. Install `dsh`:

```bash
npm install -g @deepseek-ai/dsh
# or
npx @deepseek-ai/dsh
```

2. Install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=AgentChatBus.deepseek-gold-harness).

3. Open the **DeepSeek Harness** panel in the secondary sidebar (look for the whale icon), or run **dsh: Open Chat** from the Command Palette (`Ctrl/Cmd+Shift+P`).

4. The extension automatically discovers `dsh` and connects. If `autoStart` is enabled (default), it connects on workspace open.

5. Start chatting — type a message and press `Enter` to send (`Shift+Enter` for newline). Use `@` to attach files, `/` for commands and skills.

> [!NOTE]
> Due to possible breaking changes in DeepSeek Harness, this extension may only work with specific versions of dsh.
>
> **Compatible versions:**
> - `0.1.2-alpha.5` ✅ (current — cookie auth + new RPC argument schema)
> - `0.1.0-rc.6` ✅ (legacy — flat RPC arguments, no cookie auth)

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

Both the webview UI and the extension host (VS Code commands, configuration descriptions, notifications) are localized.

## Commands

| Command | Description |
|---------|-------------|
| **dsh: Open Chat** | Focus the DeepSeek Harness chat panel |
| **Open Deepseek Harness** | Open chat from the editor title bar button |
| **dsh: Open WebUI in Browser** | Open the dsh Web UI in your system browser |
| **dsh: New Session** | Create a new conversation session |
| **dsh: Refresh Sessions** | Refresh the session list from dsh |

Access commands via the Command Palette (`Ctrl/Cmd+Shift+P`).

## Configuration

All settings are under `killea.deepseek-gold-harness.*` (scope: machine).

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `dshPath` | string\|null | `null` | Explicit path to the `dsh` executable. Empty: discover via PATH → npm global → npx. |
| `externalUrl` | string\|null | `null` | External dsh base URL. When set, the extension only connects and never manages the process. |
| `discoveryPort` | integer | `3080` | Port probed first for an existing dsh instance. |
| `managedPort` | integer | `30800` | Fixed port used by the cross-window managed dsh runtime. A non-dsh listener is reported as a conflict. |
| `autoStart` | boolean | `true` | Automatically connect to dsh when a workspace window opens. |
| `locale` | string\|null | `null` | Display language. Auto-detects VS Code's language when empty. Supported: `en`, `zh-cn`, `zh-tw`, `ja`, `de`, `fr`, `es`. |
| `minDshVersion` | string | `0.1.0-rc.6` | Reserved compatibility floor. Currently recorded but not enforced. Compatible dsh versions: `0.1.0-rc.6` and `0.1.2-alpha.5`. |

## Install

### GitHub Releases (recommended)

Download the latest VSIX from [GitHub Releases](https://github.com/Killea/A-deepseek-harness-vsc-extension/releases) and install:

```bash
code --install-extension deepseek-gold-harness-<version>.vsix
```

### Visual Studio Marketplace

[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=AgentChatBus.deepseek-gold-harness)

### Build from source

[GitHub Repo](https://github.com/Killea/A-deepseek-harness-vsc-extension)

## Roadmap

- [x] Usage display (token, context, timing)
- [x] Context occupancy breakdown
- [x] Agent preset selector (Standard, PTC, Minimal, Creative)
- [x] Multi-language i18n with instant switching
- [x] Codex-style model/reasoning selector
- [x] Hover tooltip for session statistics
- [x] Image paste from clipboard
- [x] Session fork
- [x] Real cost time (timestamp-based instead of interface timer)
- [ ] Changes list (artifact diff)
- [ ] SubAgent management
- [ ] Plugin management

## Development

```bash
pnpm i

# Debug
pnpm build
F5

# Package (output VSIX)
pnpm package
```

<details>
<summary>Project structure (for contributors)</summary>

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

</details>

## License

MIT

## Acknowledgements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [i18next](https://www.i18next.com/) / [react-i18next](https://react.i18next.com/)

## Credits

This project is a fork of [weinibuliu/deepseek-harness-vsc-extension](https://github.com/weinibuliu/deepseek-harness-vsc-extension), originally created by **weinibuliu**. The fork is maintained by **Killea** with additional features including multi-language i18n, Codex-style UI redesign, image paste support, and more.
