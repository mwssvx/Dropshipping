import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@sf/core", "@sf/db"],
  serverExternalPackages: ["@electric-sql/pglite"],
  // Migrations are read from disk at runtime.
  outputFileTracingIncludes: { "/**": ["../../packages/db/migrations/**"] },
  // Store files and document photos are bigger than the 1 MB default.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Pages can only be framed by our own admin (the theme editor's preview).
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          // No includeSubDomains: stores on merchants' own domains would force it on their other sites.
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ],
      },
    ];
  },
};

export default config;
