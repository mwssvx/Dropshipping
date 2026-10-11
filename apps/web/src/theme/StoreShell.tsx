import Link from "next/link";
import { themeFontsHref, type ThemeDoc } from "@sf/core/theme";
import { BRAND } from "@/lib/brand";
import { storeText, type StoreText } from "@/lib/store-text";
import { SectionView } from "./Sections";
import { CurrencyPicker } from "./CurrencyPicker";
import { LanguagePicker } from "./LanguagePicker";
import { storeHref, themeLayoutAttrs, themeStyle } from "./style";

/** Header, announcement bar and footer around every storefront page, styled by the theme. */
export function StoreShell({
  doc,
  shopName,
  currency,
  base,
  cartCount,
  closed,
  notice,
  verified,
  picker,
  t = storeText(null),
  languages,
  children,
}: {
  doc: ThemeDoc;
  shopName: string;
  currency: string;
  base: string;
  cartCount: number;
  closed?: boolean;
  /** A note from the store across the top of every page, like a holiday break. */
  notice?: React.ReactNode;
  /** Shown as a badge in the footer, linking to what it means. */
  verified?: boolean;
  /** When the store sells in more than one currency: the choices, the buyer's, and how to switch. */
  picker?: { currencies: string[]; current: string; action: (form: FormData) => Promise<void> };
  /** The store's fixed words in the buyer's language. */
  t?: StoreText;
  /** When the store is shown in more than one language: the buyer's, and links to this page in each. */
  languages?: { root: string; current: string; options: { code: string; name: string }[] };
  children: React.ReactNode;
}) {
  const { settings, menus } = doc;
  const fonts = themeFontsHref(settings);
  const announcement = doc.home.find((s) => s.type === "announcement" && !s.hidden);
  const logo = settings.logoText || shopName;
  const data = { base, currency, t, catalog: { products: [], collections: [] } };
  // classic: menu beside the logo; centered: logo in the middle with the menu below; minimal: menu behind a button.
  const header = settings.layout.header;
  const links = menus.header.map((m, i) => <Link key={i} href={storeHref(base, m.href)} className="hover:text-accent">{m.label}</Link>);
  return (
    <div className="store min-h-dvh flex flex-col" lang={languages?.current} style={themeStyle(settings)} {...themeLayoutAttrs(settings)}>
      {fonts && (
        <>
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link rel="stylesheet" href={fonts} precedence="default" />
        </>
      )}
      {announcement && <SectionView section={announcement} data={data} first={false} />}
      <header className="border-b border-border">
        <div className={`max-w-6xl mx-auto px-4 sm:px-6 flex items-center gap-4 ${header === "centered" ? "h-20 md:grid md:grid-cols-[1fr_auto_1fr]" : "h-16 justify-between"}`}>
          {header === "centered" && <div className="hidden md:block" aria-hidden />}
          <Link href={base || "/"} className={`text-xl font-bold tracking-tight truncate flex items-center gap-2 ${header === "centered" ? "md:text-2xl md:justify-center mr-auto md:mr-0" : ""}`}>
            {settings.logoUrl ? <img src={settings.logoUrl} alt={logo} className="h-9 w-auto" /> : logo}
          </Link>
          {header === "classic" && links.length > 0 && (
            <nav aria-label="Main" className="hidden md:flex items-center gap-6 text-sm font-medium">{links}</nav>
          )}
          <div className="flex items-center gap-2 justify-end">
            {menus.header.length > 0 && (
              <details className={`relative ${header === "minimal" ? "" : "md:hidden"}`}>
                <summary className="btn btn-secondary list-none" aria-label={t.menu}>{t.menu}</summary>
                <nav aria-label="Main" className="absolute right-0 mt-2 w-56 card p-2 flex flex-col z-20 shadow-lg">
                  {menus.header.map((m, i) => (
                    <Link key={i} href={storeHref(base, m.href)} className="px-3 py-2.5 rounded-md hover:bg-sunken">{m.label}</Link>
                  ))}
                </nav>
              </details>
            )}
            {picker && picker.currencies.length > 1 && <CurrencyPicker {...picker} />}
            <Link href={`${base}/search`} className="p-2 hover:text-accent" aria-label={t.search}>
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4.5 4.5" strokeLinecap="round" /></svg>
            </Link>
            <Link href={`${base}/saved`} className="p-2 hover:text-accent" aria-label={t.savedItems}>
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M10 17s-6.5-4.1-6.5-8.6A3.4 3.4 0 0 1 10 6a3.4 3.4 0 0 1 6.5 2.4C16.5 12.9 10 17 10 17z" strokeLinejoin="round" /></svg>
            </Link>
            <Link href={`${base}/account`} className="text-sm font-medium hover:text-accent px-2">{t.account}</Link>
            <Link href={`${base}/cart`} className="btn btn-secondary" aria-label={t.cartLabel(cartCount)}>
              {t.cart}{cartCount > 0 && <span className="num rounded-full bg-ink text-surface text-xs px-1.5 py-0.5">{cartCount}</span>}
            </Link>
          </div>
        </div>
        {header === "centered" && links.length > 0 && (
          <nav aria-label="Main" className="hidden md:flex justify-center items-center gap-8 text-sm font-medium pb-4">{links}</nav>
        )}
      </header>
      {closed && <p className="banner banner-critical rounded-none text-center">{t.closed}</p>}
      {!closed && notice && <div className="banner banner-info rounded-none text-center">{notice}</div>}
      <div className="flex-1">{children}</div>
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {menus.footer.map((m, i) => <Link key={i} href={storeHref(base, m.href)} className="hover:text-accent">{m.label}</Link>)}
            <Link href={`${base}/track`} className="hover:text-accent">{t.trackOrder}</Link>
            <Link href={`${base}/contact`} className="hover:text-accent">{t.contactUs}</Link>
          </nav>
          <div className="flex flex-wrap justify-between gap-4 hint">
            <span className="flex items-center gap-3 flex-wrap">
              © {new Date().getFullYear()} {shopName}
              {verified && (
                <Link href={`${base}/verified`} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-ink font-medium hover:border-accent">
                  <svg viewBox="0 0 16 16" className="size-3.5 text-accent" fill="currentColor" aria-hidden><path d="M8 0l2 2.2 2.9-.4.5 2.9L16 6.3 14.6 9l.6 2.9-2.9.7L11 15.2 8 14l-3 1.2-1.3-2.6-2.9-.7L1.4 9 0 6.3l2.6-1.6.5-2.9 2.9.4z" /><path d="M5 8.2l2 2 4-4.2" stroke="#fff" strokeWidth="1.6" fill="none" /></svg>
                  {t.verified}
                </Link>
              )}
            </span>
            <span className="flex items-center gap-4 flex-wrap">
              {languages && languages.options.length > 1 && <LanguagePicker {...languages} label={t.language} />}
              <span>{t.poweredBy(BRAND)}</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
