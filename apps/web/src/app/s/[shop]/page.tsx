import { headers } from "next/headers";
import { latestPosts, merchantReturnPolicy, storefrontCatalog } from "@sf/core";
import { socialLinks } from "@sf/core/theme";
import { db } from "@/lib/server";
import { buyerFx } from "@/lib/currency";
import { HomeSections } from "@/theme/Sections";
import { loadShop, loadTheme, localCollections, localProducts, storeBase, storeLang, storeT } from "./data";
import { addLookAction, addToCartAction, contactAction, newsletterAction } from "./actions";
import { readRecent } from "@/lib/recent";

export default async function StoreHome({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<{ signup?: string }> }) {
  const { shop: param } = await params;
  const { signup } = await searchParams;
  const [shop, theme, base] = await Promise.all([loadShop(param), loadTheme(param), storeBase(param)]);
  const raw = await storefrontCatalog(await db(), shop.id);
  // The cookie is only read when a section shows it.
  const recentIds = theme.home.some((s) => s.type === "recently_viewed" && !s.hidden) ? await readRecent(shop.id) : undefined;
  const posts = theme.home.some((s) => s.type === "blog_posts" && !s.hidden) ? await latestPosts(await db(), shop.id) : undefined;
  // Tells search engines who the store is: its name, logo, social pages and return policy.
  const asked = await headers();
  const origin = `${asked.get("x-forwarded-proto") ?? "https"}://${asked.get("host")}${base}`;
  const sameAs = socialLinks(theme.settings.social).map((l) => l.href);
  const returnsPage = await (await db()).query.pages.findFirst({ where: (p, { and, eq }) => and(eq(p.shopId, shop.id), eq(p.handle, "returns"), eq(p.published, true)), columns: { id: true } });
  const orgLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: shop.name,
    url: origin,
    ...(theme.settings.logoUrl ? { logo: theme.settings.logoUrl } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    hasMerchantReturnPolicy: merchantReturnPolicy(shop, returnsPage ? `${origin}/pages/returns` : undefined),
  }).replace(/</g, "\\u003c");
  const catalog = { products: await localProducts(param, raw.products), collections: await localCollections(param, raw.collections), reviews: raw.reviews };
  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: orgLd }} />
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
        contact: contactAction.bind(null, param),
        signup: { action: newsletterAction.bind(null, param), status: signup === "sent" || signup === "invalid" ? signup : null, offerPercent: shop.welcomeOffer?.percentOff ?? null },
      }} />
    </main>
  );
}
