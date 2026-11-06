import type { NextConfig } from "next";
import { securityHeaders } from "./lib/securityHeaders";

const nextConfig: NextConfig = {
  // Railway runs `node .next/standalone/server.js` (see railway.json).
  output: "standalone",
  // End-to-end tests build into their own folder so they don't clash with `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    const headers = securityHeaders({ dev: process.env.NODE_ENV === "development", production: process.env.NODE_ENV === "production" });
    return [{ source: "/:path*", headers }];
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
