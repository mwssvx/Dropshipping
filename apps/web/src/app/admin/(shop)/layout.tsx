import Link from "next/link";
import { countNeedsYou, countPendingReviews, listPendingActions, listRequirements, openNotices } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { BRAND } from "@/lib/brand";
import { switchShopAction } from "../actions";
import { NavLink } from "./NavLink";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, shop, shops, db } = await requireShop();
  const [address, requirements, notices, pending, inbox, reviews] = await Promise.all([
    storeAddress(shop),
    listRequirements(db, shop.id),
    openNotices(db, shop.id),
    listPendingActions(db, shop.id),
    countNeedsYou(db, shop.id),
    countPendingReviews(db, shop.id),
  ]);
  const approvals = pending.filter((p) => !("message_id" in p.input)).length;
  const pause = notices.find((n) => n.kind === "paused");
  const warning = notices.find((n) => n.kind === "warning");
  const holds = requirements.filter((r) => r.holdsPayouts).length;
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
          <NavLink href="/admin/assistant">Assistant{approvals ? <span className="ml-2 pill pill-warning">{approvals}</span> : null}</NavLink>
          <NavLink href="/admin/orders">Orders</NavLink>
          <NavLink href="/admin/inbox">Inbox{inbox ? <span className="ml-2 pill pill-warning">{inbox}</span> : null}</NavLink>
          <NavLink href="/admin/money">Money{holds ? <span className="ml-2 pill pill-critical">{holds}</span> : null}</NavLink>
          <NavLink href="/admin/products">Products</NavLink>
          <NavLink href="/admin/collections">Collections</NavLink>
          <NavLink href="/admin/suppliers">Suppliers</NavLink>
          <NavLink href="/admin/marketing">Marketing</NavLink>
          <NavLink href="/admin/reviews">Reviews{reviews ? <span className="ml-2 pill pill-info">{reviews}</span> : null}</NavLink>
          <span className="hidden lg:block px-3 pt-4 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">Online store</span>
          <NavLink href="/admin/theme">Theme</NavLink>
          <NavLink href="/admin/pages">Pages</NavLink>
          <NavLink href="/admin/domains">Domains</NavLink>
          <span className="hidden lg:block px-3 pt-4 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">Settings</span>
          <NavLink href="/admin/trust">Trust{notices.length ? <span className="ml-2 pill pill-warning">{notices.length}</span> : null}</NavLink>
          <NavLink href="/admin/plan">Plan</NavLink>
          <NavLink href="/admin/ai">AI settings</NavLink>
          <NavLink href="/admin/taxes">Taxes</NavLink>
        </nav>
        <div className="mt-auto hidden lg:flex flex-col gap-2 px-4 py-4 border-t border-border">
          <span className="hint truncate">{user.email}</span>
          <form action="/logout" method="post"><button className="hint hover:text-ink">Sign out</button></form>
        </div>
      </aside>
      <div className="min-w-0">
        {pause ? (
          <Link href="/admin/trust" className="block banner banner-critical rounded-none px-4 sm:px-8">
            <span className="font-semibold">Your store is paused: {pause.title.toLowerCase()}.</span> See why and how to reopen it →
          </Link>
        ) : warning ? (
          <Link href="/admin/trust" className="block banner banner-warning rounded-none px-4 sm:px-8">
            <span className="font-semibold">{warning.title}.</span> Fix it{warning.dueBy ? ` by ${warning.dueBy.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""} to keep selling as normal →
          </Link>
        ) : null}
        {children}
      </div>
    </div>
  );
}
