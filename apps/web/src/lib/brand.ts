// The product's name lives here and in NEXT_PUBLIC_BRAND_NAME only, so renaming is one change.
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Storefront";
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
// Stores live at <handle>.<root domain>. Set to "off" where wildcard subdomains aren't available
// (for example a *.vercel.app test copy); stores are then served at <root domain>/s/<handle>.
export const STORE_SUBDOMAINS = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS !== "off";
