import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@sf/core", "@sf/db"],
  serverExternalPackages: ["@electric-sql/pglite"],
  // Migrations are read from disk at runtime.
  outputFileTracingIncludes: { "/**": ["../../packages/db/migrations/**"] },
  // Store files and document photos are bigger than the 1 MB default.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default config;
