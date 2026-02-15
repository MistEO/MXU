import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path, { resolve } from "path";
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
    // 启用压缩以减小输出大小
    minify: "esbuild",
    // 禁用 source map 以加快构建速度（生产环境通常不需要）
    sourcemap: false,
    // 优化 chunk 大小
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "log-overlay": resolve(__dirname, "log-overlay.html"),
      },
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          if (normalizedId.includes("node_modules")) {
            // React 核心 - 必须精确匹配 react-dom
            if (normalizedId.includes("/react-dom/")) {
              return "vendor-react-dom";
            }
            if (normalizedId.includes("/react/")) {
              return "vendor-react";
            }
            // Markdown 渲染
            if (normalizedId.includes("/marked/") || normalizedId.includes("/dompurify/")) {
              return "vendor-markdown";
            }
            // 工具库
            if (
              normalizedId.includes("/semver/") ||
              normalizedId.includes("/jsonc-parser/") ||
              normalizedId.includes("/clsx/") ||
              normalizedId.includes("/loglevel/")
            ) {
              return "vendor-utils";
            }
            // 国际化（并入 React vendor，避免 chunk 环依赖）
            if (normalizedId.includes("/i18next/") || normalizedId.includes("/react-i18next/")) {
              return "vendor-react";
            }
            // UI 组件
            if (
              normalizedId.includes("/lucide-react/") ||
              normalizedId.includes("/react-colorful/") ||
              normalizedId.includes("/@radix-ui/")
            ) {
              return "vendor-ui";
            }
            // 拖拽
            if (normalizedId.includes("/@dnd-kit/")) {
              return "vendor-dnd";
            }
            // Tauri 相关
            if (normalizedId.includes("/@tauri-apps/")) {
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
