import { storefrontCatalog } from "@sf/core";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { HomeSections } from "@/theme/Sections";
import { loadShop, loadTheme, localCollections, localProducts, storeBase, storeT } from "./data";
import { addToCartAction, newsletterAction } from "./actions";

export default async function StoreHome({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<{ signup?: string }> }) {
  const { shop: param } = await params;
  const { signup } = await searchParams;
  const [shop, theme, base] = await Promise.all([loadShop(param), loadTheme(param), storeBase(param)]);
  const raw = await storefrontCatalog(await db(), shop.id);
  const catalog = { products: await localProducts(param, raw.products), collections: await localCollections(param, raw.collections) };
  return (
    <main>
      <h1 className="sr-only">{theme.settings.seo.title || shop.name}</h1>
      <HomeSections sections={theme.home} data={{
        base,
        currency: shop.currency,
        fx: await buyerFx(shop),
        catalog,
        t: await storeT(param),
        badges: shop.productBadges,
        quickAdd: shop.cardQuickAdd ? addToCartAction.bind(null, param) : undefined,
        signup: { action: newsletterAction.bind(null, param), status: signup === "sent" || signup === "invalid" ? signup : null, offerPercent: shop.welcomeOffer?.percentOff ?? null },
      }} />
    </main>
  );
}
