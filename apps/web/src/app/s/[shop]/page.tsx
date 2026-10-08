import { storefrontCatalog } from "@sf/core";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { HomeSections } from "@/theme/Sections";
import { loadShop, loadTheme, storeBase } from "./data";

export default async function StoreHome({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const [shop, theme, base] = await Promise.all([loadShop(param), loadTheme(param), storeBase(param)]);
  const catalog = await storefrontCatalog(await db(), shop.id);
  return (
    <main>
      <h1 className="sr-only">{theme.settings.seo.title || shop.name}</h1>
      <HomeSections sections={theme.home} data={{ base, currency: shop.currency, fx: await buyerFx(shop), catalog }} />
    </main>
  );
}
