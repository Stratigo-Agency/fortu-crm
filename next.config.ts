import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Railway runs `node .next/standalone/server.js` (see railway.json).
  output: "standalone",
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
