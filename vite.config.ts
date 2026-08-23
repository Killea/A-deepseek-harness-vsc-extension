/**
 * Vite build for the webview React app (ui/) -> dist/media/webview/.
 * The extension host bundle stays with esbuild.mjs; this config only handles
 * the webview frontend (React + Tailwind v4).
 */

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));

/** Strip comments from .jsonc files so Vite can parse them as JSON. */
function jsoncPlugin(): Plugin {
  return {
    name: "jsonc",
    transform(_code, id) {
      if (!id.endsWith(".jsonc")) return null;
      const raw = readFileSync(id, "utf8");
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//gu, "") // block comments
        .replace(/(^|[^:])\/\/.*$/gmu, "$1"); // line comments (not after :)
      return { code: `export default ${stripped};`, map: null };
    },
  };
}

export default defineConfig({
  root: join(root, "ui"),
  base: "./",
  plugins: [react(), tailwindcss(), jsoncPlugin()],
  resolve: {
    alias: {
      "@ui": join(root, "ui"),
    },
  },
  build: {
    outDir: join(root, "dist", "media", "webview"),
    emptyOutDir: true,
    sourcemap: true,
    // Keep @ui/favicon.svg as a real asset file instead of an inlined data URI.
    assetsInlineLimit: 0,
  },
});
