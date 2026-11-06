import type { NextConfig } from "next";
import { META_SDK_PAGE, metaSdkPageHeaders, securityHeaders } from "./lib/securityHeaders";

const nextConfig: NextConfig = {
  // Railway runs `node .next/standalone/server.js` (see railway.json).
  output: "standalone",
  // End-to-end tests build into their own folder so they don't clash with `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    const dev = process.env.NODE_ENV === "development";
    const headers = securityHeaders({ dev, production: process.env.NODE_ENV === "production" });
    // Pengaturan › WhatsApp loads Meta's SDK; every other page keeps the strict policy.
    return [{ source: "/:path*", headers }, { source: META_SDK_PAGE, headers: metaSdkPageHeaders({ dev }) }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
