import { getTheme, storefrontCatalog } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PreviewClient } from "./PreviewClient";

export const metadata = { title: "Preview", robots: { index: false } };

/** The editor's live preview. It renders the draft it is sent, with this store's real products. */
export default async function PreviewPage() {
  const { shop, db } = await requireShop();
  const [theme, catalog] = await Promise.all([getTheme(db, shop), storefrontCatalog(db, shop.id)]);
  return <PreviewClient initial={theme.draft} shopName={shop.name} currency={shop.currency} catalog={catalog} base={`/s/${shop.handle}`} />;
}
