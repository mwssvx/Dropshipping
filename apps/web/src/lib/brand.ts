// The product's name lives here and in NEXT_PUBLIC_BRAND_NAME only, so renaming is one change.
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Storefront";
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
// Stores live at <handle>.<root domain>. Set to "off" where wildcard subdomains aren't available
// (for example a *.vercel.app test copy); stores are then served at <root domain>/s/<handle>.
export const STORE_SUBDOMAINS = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS !== "off";
// Set by the proxy when a request came in on a store's own address (see src/proxy.ts).
export const STORE_HOST_HEADER = "x-sf-store-host";
