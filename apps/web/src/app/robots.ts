import type { MetadataRoute } from "next";
import { ROOT_DOMAIN } from "@/lib/brand";

const base = `${/^(localhost|127\.0\.0\.1)(:|$)/.test(ROOT_DOMAIN) ? "http" : "https"}://${ROOT_DOMAIN}`;

/** The platform's own pages. Stores have their own robots.txt at their address. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/staff", "/api", "/reset", "/dev"] }], sitemap: `${base}/sitemap.xml` };
}
