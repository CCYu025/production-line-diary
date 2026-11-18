import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// 開發時 Vite 代理 /api、/photos 到後端；後端的 Host 檢查只認 localhost / 127.0.0.1，
// 所以 changeOrigin: true 把 Host 改成後端的位址。後端 port 預設 3000，可用 BACKEND_PORT 覆寫。
const backend = `http://127.0.0.1:${process.env.BACKEND_PORT ?? 3000}`;

// @fontsource 的 CSS 同時列 woff2 與 woff（舊瀏覽器備援）。這個 App 只在現代瀏覽器用，
// 拿掉 woff 讓 dist 的字型檔少一半。
function dropWoffFallback(): Plugin {
  return {
    name: "drop-woff-fallback",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@fontsource") || !id.endsWith(".css")) return null;
      return code.replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, "");
    },
  };
}

export default defineConfig({
  root,
  // Express 把 web/dist 直接掛在 /（見 backend/lib/webUi.js；舊的 /next/ 網址會轉址到 /）。
  base: "/",
  plugins: [dropWoffFallback(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // 前後端共用邏輯（backend/lib/aggregate.js）直接引用，不複製；型別在 aggregate.d.ts / types.d.ts。
      "@shared": path.resolve(root, "../backend/lib"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    fs: { allow: [path.resolve(root, "..")] },
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/photos": { target: backend, changeOrigin: true },
    },
  },
  build: {
    // 預設 dist。scripts/verify/verify-holo.mjs 的實驗室建置用 WEB_OUT_DIR（絕對路徑，或相對於執行目錄）輸出到別處，才不會覆蓋預設的 web/dist。
    outDir: process.env.WEB_OUT_DIR ? path.resolve(process.env.WEB_OUT_DIR) : "dist",
    emptyOutDir: true,
    sourcemap: false,
    // dist/.vite/manifest.json：scripts/verify/os-bundle.mjs 用它把 chunk 對回原始模組路徑（群組制，HB4）。只多一個檔案，不改任何 chunk 的內容。
    manifest: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    css: false,
  },
});
