import Link from "next/link";
import { readCart } from "@/lib/cart";
import { BRAND } from "@/lib/brand";
import { loadShop } from "./data";

export async function generateMetadata({ params }: { params: Promise<{ shop: string }> }) {
  const shop = await loadShop((await params).shop);
  return { title: { default: shop.name, template: `%s · ${shop.name}` } };
}

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const count = (await readCart(shop.id)).reduce((s, l) => s + l.quantity, 0);
  return (
    <div className="min-h-dvh flex flex-col bg-surface">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href={`/s/${handle}`} className="text-xl font-bold tracking-tight truncate">{shop.name}</Link>
          <Link href={`/s/${handle}/cart`} className="btn btn-secondary" aria-label={`Cart, ${count} items`}>
            Cart{count > 0 && <span className="num rounded-full bg-ink text-surface text-xs px-1.5 py-0.5">{count}</span>}
          </Link>
        </div>
      </header>
      {shop.status !== "active" && (
        <p className="banner banner-critical rounded-none text-center">This store isn't taking orders right now.</p>
      )}
      <div className="flex-1">{children}</div>
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-wrap justify-between gap-4 hint">
          <span>© {new Date().getFullYear()} {shop.name}</span>
          <span>Powered by {BRAND}</span>
        </div>
      </footer>
    </div>
  );
}
