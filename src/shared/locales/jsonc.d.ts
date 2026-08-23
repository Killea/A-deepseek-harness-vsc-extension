/**
 * Ambient module declarations for `.jsonc` imports.
 *
 * Vite (webview) and esbuild (host) both strip JSONC comments at build time
 * and parse the result as JSON; this declaration lets TypeScript accept
 * `import x from "./file.jsonc"` during typecheck.
 */

declare module "*.jsonc" {
  const value: Record<string, unknown>;
  export default value;
}
