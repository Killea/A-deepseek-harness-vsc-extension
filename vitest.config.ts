import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

/** Strip comments from .jsonc files so Vite can parse them as JSON. */
function jsoncPlugin() {
  return {
    name: "jsonc",
    enforce: "pre" as const,
    transform(_code: string, id: string) {
      if (!id.endsWith(".jsonc")) return null;
      const raw = readFileSync(id, "utf8");
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/(^|[^:])\/\/.*$/gmu, "$1");
      return {
        code: `export default ${stripped};`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  esbuild: { jsx: "automatic" },
  plugins: [jsoncPlugin()],
  test: {
    include: ["tests/**/*.test.ts", "ui/src/**/*.spec.{ts,tsx}"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: {
      deps: {
        // Allow .jsonc imports in test files via the plugin transform.
        inline: [/\.jsonc$/],
      },
    },
  },
});
