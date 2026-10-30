import { storefrontCatalog } from "@sf/core";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { HomeSections } from "@/theme/Sections";
import { loadShop, loadTheme, localCollections, localProducts, storeBase, storeT } from "./data";
import { addLookAction, addToCartAction, newsletterAction } from "./actions";
import { readRecent } from "@/lib/recent";

export default async function StoreHome({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<{ signup?: string }> }) {
  const { shop: param } = await params;
  const { signup } = await searchParams;
  const [shop, theme, base] = await Promise.all([loadShop(param), loadTheme(param), storeBase(param)]);
  const raw = await storefrontCatalog(await db(), shop.id);
  // The cookie is only read when a section shows it.
  const recentIds = theme.home.some((s) => s.type === "recently_viewed" && !s.hidden) ? await readRecent(shop.id) : undefined;
  const catalog = { products: await localProducts(param, raw.products), collections: await localCollections(param, raw.collections), reviews: raw.reviews };
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
        recentIds,
        quickAdd: shop.cardQuickAdd ? addToCartAction.bind(null, param) : undefined,
        addLook: addLookAction.bind(null, param),
        signup: { action: newsletterAction.bind(null, param), status: signup === "sent" || signup === "invalid" ? signup : null, offerPercent: shop.welcomeOffer?.percentOff ?? null },
      }} />
    </main>
  );
}
