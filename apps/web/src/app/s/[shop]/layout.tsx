import { readCart } from "@/lib/cart";
import { Track } from "@/components/Track";
import { StoreShell } from "@/theme/StoreShell";
import { shopCurrencies } from "@sf/core";
import { buyerFx } from "@/lib/currency";
import { setCurrencyAction } from "./actions";
import { loadShop, loadTheme, storeBase } from "./data";

export async function generateMetadata({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const [shop, theme] = await Promise.all([loadShop(param), loadTheme(param)]);
  const { title, description } = theme.settings.seo;
  return {
    title: { default: title || shop.name, template: `%s · ${shop.name}` },
    description: description || undefined,
    openGraph: { siteName: shop.name, type: "website" },
  };
}

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const [shop, theme, base] = await Promise.all([loadShop(param), loadTheme(param), storeBase(param)]);
  const count = (await readCart(shop.id)).reduce((s, l) => s + l.quantity, 0);
  const currencies = shopCurrencies(shop);
  const picker = currencies.length > 1 ? { currencies, current: (await buyerFx(shop)).currency, action: setCurrencyAction.bind(null, param) } : undefined;
  return (
    <StoreShell doc={theme} shopName={shop.name} currency={shop.currency} base={base} cartCount={count} closed={shop.status !== "active"} verified={!!shop.verifiedAt && shop.status === "active"} picker={picker}>
      <Track shopId={shop.id} kind="page_view" />
      {children}
    </StoreShell>
  );
}
