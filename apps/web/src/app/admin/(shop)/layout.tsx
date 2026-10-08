import { requireShop, storeAddress } from "@/lib/server";
import { BRAND } from "@/lib/brand";
import { switchShopAction } from "../actions";
import { NavLink } from "./NavLink";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, shop, shops } = await requireShop();
  const address = await storeAddress(shop);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="bg-surface border-b lg:border-b-0 lg:border-r border-border lg:min-h-dvh flex flex-col">
        <div className="px-4 py-4 flex items-center justify-between gap-2">
          <span className="font-bold tracking-tight">{BRAND}</span>
          <a href={address} target="_blank" className="hint hover:text-accent" title={address.replace(/^https?:\/\//, "")}>
            View store ↗
          </a>
        </div>
        {shops.length > 1 ? (
          <form action={switchShopAction} className="px-3 pb-3">
            <label className="sr-only" htmlFor="shopId">Store</label>
            <select id="shopId" name="shopId" defaultValue={shop.id} className="input text-sm">
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn btn-secondary w-full mt-2">Switch store</button>
          </form>
        ) : (
          <div className="px-4 pb-3 text-sm font-semibold truncate">{shop.name}</div>
        )}
        <nav className="flex lg:flex-col gap-1 px-2 pb-3 overflow-x-auto" aria-label="Admin">
          <NavLink href="/admin" exact>Home</NavLink>
          <NavLink href="/admin/orders">Orders</NavLink>
          <NavLink href="/admin/products">Products</NavLink>
          <NavLink href="/admin/collections">Collections</NavLink>
          <NavLink href="/admin/suppliers">Suppliers</NavLink>
          <span className="hidden lg:block px-3 pt-4 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">Online store</span>
          <NavLink href="/admin/theme">Theme</NavLink>
          <NavLink href="/admin/pages">Pages</NavLink>
          <NavLink href="/admin/domains">Domains</NavLink>
        </nav>
        <div className="mt-auto hidden lg:flex flex-col gap-2 px-4 py-4 border-t border-border">
          <span className="hint truncate">{user.email}</span>
          <form action="/logout" method="post"><button className="hint hover:text-ink">Sign out</button></form>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
