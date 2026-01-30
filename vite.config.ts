import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "node:fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8")
) as { version?: string };
const mxuVersion = pkg.version ?? "0.0.0";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __MXU_VERSION__: JSON.stringify(mxuVersion),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // React 核心 - 必须精确匹配 react-dom
            if (id.includes("/react-dom/")) {
              return "vendor-react-dom";
            }
            if (id.includes("/react/")) {
              return "vendor-react";
            }
            // Markdown 渲染
            if (id.includes("/marked/") || id.includes("/dompurify/")) {
              return "vendor-markdown";
            }
            // 工具库
            if (
              id.includes("/semver/") ||
              id.includes("/jsonc-parser/") ||
              id.includes("/clsx/") ||
              id.includes("/loglevel/")
            ) {
              return "vendor-utils";
            }
            // 国际化
            if (id.includes("/i18next/") || id.includes("/react-i18next/")) {
              return "vendor-i18n";
            }
            // UI 组件
            if (
              id.includes("/lucide-react/") ||
              id.includes("/react-colorful/") ||
              id.includes("/@radix-ui/")
            ) {
              return "vendor-ui";
            }
            // 拖拽
            if (id.includes("/@dnd-kit/")) {
              return "vendor-dnd";
            }
            // Tauri 相关
            if (id.includes("/@tauri-apps/")) {
              return "vendor-tauri";
            }
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
