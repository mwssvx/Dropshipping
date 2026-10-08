import Link from "next/link";
import { themeFontsHref, type ThemeDoc } from "@sf/core/theme";
import { BRAND } from "@/lib/brand";
import { SectionView } from "./Sections";
import { storeHref, themeStyle } from "./style";

/** Header, announcement bar and footer around every storefront page, styled by the theme. */
export function StoreShell({
  doc,
  shopName,
  currency,
  base,
  cartCount,
  closed,
  verified,
  children,
}: {
  doc: ThemeDoc;
  shopName: string;
  currency: string;
  base: string;
  cartCount: number;
  closed?: boolean;
  /** Shown as a badge in the footer, linking to what it means. */
  verified?: boolean;
  children: React.ReactNode;
}) {
  const { settings, menus } = doc;
  const fonts = themeFontsHref(settings);
  const announcement = doc.home.find((s) => s.type === "announcement" && !s.hidden);
  const logo = settings.logoText || shopName;
  const data = { base, currency, catalog: { products: [], collections: [] } };
  return (
    <div className="store min-h-dvh flex flex-col" style={themeStyle(settings)}>
      {fonts && (
        <>
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link rel="stylesheet" href={fonts} precedence="default" />
        </>
      )}
      {announcement && <SectionView section={announcement} data={data} first={false} />}
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href={base || "/"} className="text-xl font-bold tracking-tight truncate flex items-center gap-2">
            {settings.logoUrl ? <img src={settings.logoUrl} alt={logo} className="h-9 w-auto" /> : logo}
          </Link>
          {menus.header.length > 0 && (
            <nav aria-label="Main" className="hidden md:flex items-center gap-6 text-sm font-medium">
              {menus.header.map((m, i) => <Link key={i} href={storeHref(base, m.href)} className="hover:text-accent">{m.label}</Link>)}
            </nav>
          )}
          <div className="flex items-center gap-2">
            {menus.header.length > 0 && (
              <details className="md:hidden relative">
                <summary className="btn btn-secondary list-none" aria-label="Menu">Menu</summary>
                <nav aria-label="Main" className="absolute right-0 mt-2 w-56 card p-2 flex flex-col z-20 shadow-lg">
                  {menus.header.map((m, i) => (
                    <Link key={i} href={storeHref(base, m.href)} className="px-3 py-2.5 rounded-md hover:bg-sunken">{m.label}</Link>
                  ))}
                </nav>
              </details>
            )}
            <Link href={`${base}/account`} className="text-sm font-medium hover:text-accent px-2">Account</Link>
            <Link href={`${base}/cart`} className="btn btn-secondary" aria-label={`Cart, ${cartCount} items`}>
              Cart{cartCount > 0 && <span className="num rounded-full bg-ink text-surface text-xs px-1.5 py-0.5">{cartCount}</span>}
            </Link>
          </div>
        </div>
      </header>
      {closed && <p className="banner banner-critical rounded-none text-center">This store isn't taking orders right now.</p>}
      <div className="flex-1">{children}</div>
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
          {menus.footer.length > 0 && (
            <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {menus.footer.map((m, i) => <Link key={i} href={storeHref(base, m.href)} className="hover:text-accent">{m.label}</Link>)}
            </nav>
          )}
          <div className="flex flex-wrap justify-between gap-4 hint">
            <span className="flex items-center gap-3 flex-wrap">
              © {new Date().getFullYear()} {shopName}
              {verified && (
                <Link href={`${base}/verified`} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-ink font-medium hover:border-accent">
                  <svg viewBox="0 0 16 16" className="size-3.5 text-accent" fill="currentColor" aria-hidden><path d="M8 0l2 2.2 2.9-.4.5 2.9L16 6.3 14.6 9l.6 2.9-2.9.7L11 15.2 8 14l-3 1.2-1.3-2.6-2.9-.7L1.4 9 0 6.3l2.6-1.6.5-2.9 2.9.4z" /><path d="M5 8.2l2 2 4-4.2" stroke="#fff" strokeWidth="1.6" fill="none" /></svg>
                  Verified store
                </Link>
              )}
            </span>
            <span>Powered by {BRAND}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
