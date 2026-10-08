import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@sf/core", "@sf/db"],
  serverExternalPackages: ["@electric-sql/pglite"],
  // Migrations are read from disk at runtime.
  outputFileTracingIncludes: { "/**": ["../../packages/db/migrations/**"] },
};

export default config;
