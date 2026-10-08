import type { MetadataRoute } from "next";
import { ROOT_DOMAIN } from "@/lib/brand";
import { LEGAL_DOCS } from "./(marketing)/legal/docs";

const base = `${/^(localhost|127\.0\.0\.1)(:|$)/.test(ROOT_DOMAIN) ? "http" : "https"}://${ROOT_DOMAIN}`;

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/pricing", "/signup", ...LEGAL_DOCS.map((d) => `/legal/${d.slug}`)].map((p) => ({ url: `${base}${p}` }));
}
