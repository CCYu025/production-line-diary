// 字型自行託管（不連 Google Fonts）：只打包用到的字重（Sans 400/700、Serif 700、Mono 400/500；中間字重由瀏覽器就近取用）；中文字型是 unicode-range 分包，瀏覽器只下載頁面用到的字。
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/700.css";
import "@fontsource/noto-serif-tc/700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
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
