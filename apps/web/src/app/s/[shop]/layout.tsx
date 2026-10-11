import { readCart } from "@/lib/cart";
import { Track } from "@/components/Track";
import { StoreShell } from "@/theme/StoreShell";
import { LANGUAGES, needsConsent, shopCurrencies, shopLanguages, storePixels } from "@sf/core";
import { AdPixels } from "@/components/AdPixels";
import { storeAddress } from "@/lib/server";
import { buyerCountry, buyerFx } from "@/lib/currency";
import { setCurrencyAction } from "./actions";
import { loadShop, loadTheme, storeBase, storeLang, storePath, storeRoot, storeT } from "./data";

/** This page in English and in each language the store offers. */
async function languageLinks(param: string, prefix: string) {
  const shop = await loadShop(param);
  const langs = shopLanguages(shop);
  if (!langs.length) return null;
  const path = await storePath();
  const href = (code: string | null) => `${prefix}${code ? `/${code}` : ""}${path === "/" ? "" : path}` || "/";
  return [{ code: "en", name: "English", href: href(null) }, ...langs.map((l) => ({ code: l, name: LANGUAGES[l].name, href: href(l) }))];
}

export async function generateMetadata({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const [shop, theme] = await Promise.all([loadShop(param), loadTheme(param)]);
  const { title, description } = theme.settings.seo;
  // Search engines learn about each language version of the page.
  const links = await languageLinks(param, await storeAddress(shop));
  return {
    title: { default: title || shop.name, template: `%s · ${shop.name}` },
    description: description || undefined,
    openGraph: { siteName: shop.name, type: "website" },
    alternates: links ? { languages: Object.fromEntries(links.map((l) => [l.code, l.href])) } : undefined,
  };
}

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const [shop, theme, base, t, lang, root] = await Promise.all([loadShop(param), loadTheme(param), storeBase(param), storeT(param), storeLang(param), storeRoot(param)]);
  const langs = shopLanguages(shop);
  const count = (await readCart(shop.id)).reduce((s, l) => s + l.quantity, 0);
  const currencies = shopCurrencies(shop);
  // Ad tags, once the buyer agrees where the law asks for it.
  const pixels = storePixels(shop);
  const ask = pixels ? needsConsent(shop, await buyerCountry()) : false;
  const picker = currencies.length > 1 ? { currencies, current: (await buyerFx(shop)).currency, action: setCurrencyAction.bind(null, param) } : undefined;
  return (
    <StoreShell doc={theme} shopName={shop.name} currency={shop.currency} base={base} cartCount={count} closed={shop.status !== "active"} verified={!!shop.verifiedAt && shop.status === "active"} picker={picker} t={t} languages={langs.length ? { root, current: lang ?? "en", options: [{ code: "en", name: "English" }, ...langs.map((l) => ({ code: l, name: LANGUAGES[l].name }))] } : undefined}>
      <Track shopId={shop.id} kind="page_view" />
      {children}
      {pixels && <AdPixels ids={pixels} ask={ask} text={{ message: t.cookieMessage, accept: t.cookieAccept, decline: t.cookieDecline, settings: t.cookieSettings }} />}
    </StoreShell>
  );
}
