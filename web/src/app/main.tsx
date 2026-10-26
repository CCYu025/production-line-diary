// 字型自行託管（不連 Google Fonts）：只打包用到的字重（Sans 400/500/700/900、Serif 400/900、Mono 400/500/600；其餘字重由瀏覽器就近取用）；中文字型是 unicode-range 分包，瀏覽器只下載頁面用到的字。
// Sans 500/900、Serif 400/900、Mono 600 是列印報表的報紙式排版用的（features/report/report.css）。
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/500.css";
import "@fontsource/noto-sans-tc/700.css";
import "@fontsource/noto-sans-tc/900.css";
import "@fontsource/noto-serif-tc/400.css";
import "@fontsource/noto-serif-tc/900.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "../styles/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { createQueryClient } from "@/lib/queryClient";
import { Providers } from "./Providers";
import { createRouter } from "./routes";

const queryClient = createQueryClient();
const router = createRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers client={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
