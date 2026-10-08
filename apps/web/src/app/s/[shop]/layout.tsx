import { readCart } from "@/lib/cart";
import { StoreShell } from "@/theme/StoreShell";
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
  return (
    <StoreShell doc={theme} shopName={shop.name} currency={shop.currency} base={base} cartCount={count} closed={shop.status !== "active"} verified={!!shop.verifiedAt && shop.status === "active"}>
      {children}
    </StoreShell>
  );
}
