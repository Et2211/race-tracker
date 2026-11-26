import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
    agentUpgrade: "security",
  },
  cacheComponents: true,
  // Read at runtime by the API routes: recorded fixtures and learned marshal-sector positions.
  outputFileTracingIncludes: {
    "/api/**": ["./fixtures/openf1/**", "./data/**"],
    // The share images' font, should they ever be built on request rather than at build time.
    "/opengraph-image": ["./assets/fonts/**"],
    "/twitter-image": ["./assets/fonts/**"],
  },
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
