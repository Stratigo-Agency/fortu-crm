import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Railway runs `node .next/standalone/server.js` (see railway.json).
  output: "standalone",
  // End-to-end tests build into their own folder so they don't clash with `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
