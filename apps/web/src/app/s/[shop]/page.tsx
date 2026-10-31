import { headers } from "next/headers";
import { latestPosts, storefrontCatalog } from "@sf/core";
import { socialLinks } from "@sf/core/theme";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { HomeSections } from "@/theme/Sections";
import { loadShop, loadTheme, localCollections, localProducts, storeBase, storeLang, storeT } from "./data";
import { addLookAction, addToCartAction, newsletterAction } from "./actions";
import { readRecent } from "@/lib/recent";

export default async function StoreHome({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<{ signup?: string }> }) {
  const { shop: param } = await params;
  const { signup } = await searchParams;
  const [shop, theme, base] = await Promise.all([loadShop(param), loadTheme(param), storeBase(param)]);
  const raw = await storefrontCatalog(await db(), shop.id);
  // The cookie is only read when a section shows it.
  const recentIds = theme.home.some((s) => s.type === "recently_viewed" && !s.hidden) ? await readRecent(shop.id) : undefined;
  const posts = theme.home.some((s) => s.type === "blog_posts" && !s.hidden) ? await latestPosts(await db(), shop.id) : undefined;
  // Tells search engines which social pages are the store's own.
  const asked = await headers();
  const sameAs = socialLinks(theme.settings.social).map((l) => l.href);
  const orgLd = sameAs.length
    ? JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: shop.name,
        url: `${asked.get("x-forwarded-proto") ?? "https"}://${asked.get("host")}${base}`,
        ...(theme.settings.logoUrl ? { logo: theme.settings.logoUrl } : {}),
        sameAs,
      }).replace(/</g, "\\u003c")
    : null;
  const catalog = { products: await localProducts(param, raw.products), collections: await localCollections(param, raw.collections), reviews: raw.reviews };
  return (
    <main>
      {orgLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: orgLd }} />}
      <h1 className="sr-only">{theme.settings.seo.title || shop.name}</h1>
      <HomeSections sections={theme.home} data={{
        base,
        currency: shop.currency,
        fx: await buyerFx(shop),
        catalog,
        t: await storeT(param),
        badges: shop.productBadges,
        recentIds,
        posts,
        lang: (await storeLang(param)) ?? undefined,
        quickAdd: shop.cardQuickAdd ? addToCartAction.bind(null, param) : undefined,
        addLook: addLookAction.bind(null, param),
        signup: { action: newsletterAction.bind(null, param), status: signup === "sent" || signup === "invalid" ? signup : null, offerPercent: shop.welcomeOffer?.percentOff ?? null },
      }} />
    </main>
  );
}
