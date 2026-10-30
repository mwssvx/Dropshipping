import { getTheme, listCollections, listPages, productChoices } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { ThemeEditor } from "./ThemeEditor";

export const metadata = { title: "Theme" };

export default async function ThemePage() {
  const { shop, db } = await requireShop("theme");
  const [theme, collections, pages, products, storeLink] = await Promise.all([
    getTheme(db, shop),
    listCollections(db, shop.id),
    listPages(db, shop.id),
    productChoices(db, shop.id),
    storeAddress(shop),
  ]);
  // Suggestions for every link field: the store's own pages first.
  const links = [
    { label: "Home", href: "/" },
    { label: "All products", href: "/collections/all" },
    { label: "Blog", href: "/blog" },
    { label: "Search", href: "/search" },
    ...collections.map((c) => ({ label: c.title, href: `/collections/${c.handle}` })),
    ...pages.map((p) => ({ label: p.title, href: `/pages/${p.handle}` })),
    ...products.filter((p) => p.status === "active").slice(0, 50).map((p) => ({ label: p.title, href: `/products/${p.handle}` })),
  ];
  return (
    <ThemeEditor
      initial={theme.draft}
      hasChanges={theme.hasChanges}
      publishedAt={theme.publishedAt?.toISOString() ?? null}
      links={links}
      collections={collections.map((c) => ({ id: c.id, title: c.title }))}
      products={products.filter((p) => p.status === "active" && !p.giftCard).map((p) => ({ id: p.id, title: p.title }))}
      schedule={theme.schedule}
      revertAt={theme.revertAt}
      storeLink={storeLink}
      shopName={shop.name}
    />
  );
}
