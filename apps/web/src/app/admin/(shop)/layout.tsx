import Link from "next/link";
import { can, countNeedsYou, countPendingReviews, countOpenReturns, countPendingWholesale, listPendingActions, waitingQuestions, listRequirements, openNotices, ROLES, type Area } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { BRAND } from "@/lib/brand";
import { switchShopAction } from "../actions";
import { NavLink } from "./NavLink";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, shop, shops, db, role } = await requireShop();
  const show = (area: Area) => can(role, area);
  const [address, requirements, notices, pending, inbox, reviews, wholesale, returns, questions] = await Promise.all([
    storeAddress(shop),
    listRequirements(db, shop.id),
    openNotices(db, shop.id),
    listPendingActions(db, shop.id),
    countNeedsYou(db, shop.id),
    countPendingReviews(db, shop.id),
    show("wholesale") ? countPendingWholesale(db, shop.id) : 0,
    show("returns") ? countOpenReturns(db, shop.id) : 0,
    show("reviews") ? waitingQuestions(db, shop.id) : 0,
  ]);
  const approvals = pending.filter((p) => !("message_id" in p.input)).length;
  const pause = notices.find((n) => n.kind === "paused");
  const warning = notices.find((n) => n.kind === "warning");
  const holds = show("money") ? requirements.filter((r) => r.holdsPayouts).length : 0;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="print:hidden bg-surface border-b lg:border-b-0 lg:border-r border-border lg:min-h-dvh flex flex-col">
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
          {show("analytics") && <NavLink href="/admin/analytics">Analytics</NavLink>}
          {show("assistant") && <NavLink href="/admin/assistant">Assistant{approvals ? <span className="ml-2 pill pill-warning">{approvals}</span> : null}</NavLink>}
          {show("orders") && <NavLink href="/admin/orders">Orders</NavLink>}
          {show("returns") && <NavLink href="/admin/returns">Returns{returns ? <span className="ml-2 pill pill-warning">{returns}</span> : null}</NavLink>}
          {show("customers") && <NavLink href="/admin/customers">Customers</NavLink>}
          {show("inbox") && <NavLink href="/admin/inbox">Inbox{inbox ? <span className="ml-2 pill pill-warning">{inbox}</span> : null}</NavLink>}
          {show("money") && <NavLink href="/admin/money">Money{holds ? <span className="ml-2 pill pill-critical">{holds}</span> : null}</NavLink>}
          {show("products") && <NavLink href="/admin/products">Products</NavLink>}
          {show("products") && <NavLink href="/admin/pricing">Pricing</NavLink>}
          {show("products") && <NavLink href="/admin/size-charts">Size charts</NavLink>}
          {show("collections") && <NavLink href="/admin/collections">Collections</NavLink>}
          {show("suppliers") && <NavLink href="/admin/suppliers">Suppliers</NavLink>}
          {show("marketing") && <NavLink href="/admin/marketing">Marketing</NavLink>}
          {show("marketing") && <NavLink href="/admin/campaigns">Email campaigns</NavLink>}
          {show("marketing") && <NavLink href="/admin/sales">Sales</NavLink>}
          {show("marketing") && <NavLink href="/admin/bundles">Bundles</NavLink>}
          {show("marketing") && <NavLink href="/admin/addons">Checkout add-ons</NavLink>}
          {show("marketing") && <NavLink href="/admin/rewards">Rewards</NavLink>}
          {show("gift_cards") && <NavLink href="/admin/gift-cards">Gift cards</NavLink>}
          {show("wholesale") && <NavLink href="/admin/wholesale">Wholesale{wholesale ? <span className="ml-2 pill pill-warning">{wholesale}</span> : null}</NavLink>}
          {show("reviews") && <NavLink href="/admin/reviews">Reviews{reviews ? <span className="ml-2 pill pill-info">{reviews}</span> : null}</NavLink>}
          {show("reviews") && <NavLink href="/admin/questions">Questions{questions ? <span className="ml-2 pill pill-info">{questions}</span> : null}</NavLink>}
          {show("theme") && <span className="hidden lg:block px-3 pt-4 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">Online store</span>}
          {show("theme") && <NavLink href="/admin/theme">Theme</NavLink>}
          {show("pages") && <NavLink href="/admin/pages">Pages</NavLink>}
          {show("pages") && <NavLink href="/admin/blog">Blog</NavLink>}
          {show("domains") && <NavLink href="/admin/domains">Domains</NavLink>}
          {show("domains") && <NavLink href="/admin/redirects">Redirects</NavLink>}
          {show("theme") && <NavLink href="/admin/languages">Languages</NavLink>}
          {show("marketing") && <NavLink href="/admin/channels">Sales channels</NavLink>}
          <span className="hidden lg:block px-3 pt-4 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">Settings</span>
          <NavLink href="/admin/team">Team</NavLink>
          {show("trust") && <NavLink href="/admin/trust">Trust{notices.length ? <span className="ml-2 pill pill-warning">{notices.length}</span> : null}</NavLink>}
          {show("plan") && <NavLink href="/admin/plan">Plan</NavLink>}
          {show("ai") && <NavLink href="/admin/ai">AI settings</NavLink>}
          {show("shipping") && <NavLink href="/admin/shipping">Shipping</NavLink>}
          {show("taxes") && <NavLink href="/admin/taxes">Taxes</NavLink>}
          {show("taxes") && <NavLink href="/admin/invoices">Invoices</NavLink>}
          {show("currencies") && <NavLink href="/admin/currencies">Currencies</NavLink>}
          {show("developers") && <NavLink href="/admin/developers">Developers</NavLink>}
          {show("export") && <NavLink href="/admin/export">Export and import</NavLink>}
        </nav>
        <div className="mt-auto hidden lg:flex flex-col gap-2 px-4 py-4 border-t border-border">
          <span className="hint truncate">{user.email}</span>
          {role !== "owner" && <span className="hint">{ROLES[role].name} on this store</span>}
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
