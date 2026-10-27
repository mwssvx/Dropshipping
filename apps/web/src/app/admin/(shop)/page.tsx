import Link from "next/link";
import { can, formatMoney, homeCounts, listRequirements, soldOutAtSupplier, twoStepStatus } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "./PageHeader";

export const metadata = { title: "Home" };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { shop, db, role, user } = await requireShop("home");
  const { denied } = await searchParams;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [counts, requirements, twoStep, soldOut] = await Promise.all([
    homeCounts(db, shop.id, startOfDay),
    listRequirements(db, shop.id),
    twoStepStatus(db, user.id),
    can(role, "products") ? soldOutAtSupplier(db, shop.id) : [],
  ]);
  const seesMoney = can(role, "money");
  const holds = seesMoney ? requirements.filter((r) => r.holdsPayouts) : [];
  const { held, toSend, problems } = counts;

  const steps = [
    { done: true, title: "Create your store", href: "/admin" },
    { done: counts.products > 0, title: "Import your first product", href: "/admin/products/import" },
    { done: counts.activeProducts > 0, title: "Make a product active so buyers can see it", href: "/admin/products" },
    { done: counts.paid > 0, title: "Place a test order on your store", href: `/s/${shop.handle}` },
    { done: shop.payoutsEnabled || requirements.length > 0, title: "Set up payouts so you get paid", href: "/admin/money" },
    { done: twoStep.on, title: "Turn on two-step sign-in to keep your money safe", href: "/admin/account" },
  ];
  const left = steps.filter((s) => !s.done).length;

  return (
    <main className="pb-12">
      <PageHeader title={`Welcome to ${shop.name}`} />
      {denied && (
        <p className="banner banner-warning mx-4 sm:mx-8 mb-6" role="status">
          Your role on this store doesn&apos;t include that page. The owner can change your role on the Team page.
        </p>
      )}
      <div className="px-4 sm:px-8 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6 min-w-0">
          <section className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border border border-border rounded-xl overflow-hidden">
            {[
              seesMoney ? ["Sales today", formatMoney(counts.todayMinor, shop.currency)] : ["Paid orders", String(counts.paid)],
              ["Orders today", String(counts.today)],
              ["Products", String(counts.products)],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface p-4 flex flex-col gap-1">
                <span className="hint">{k}</span>
                <span className="text-2xl font-semibold num">{v}</span>
              </div>
            ))}
          </section>
          <section className="card">
            <h2 className="font-semibold px-4 pt-4">Needs your attention</h2>
            {toSend || problems || holds.length || held || soldOut.length ? (
              <ul className="p-2">
                {holds.length > 0 && (
                  <li>
                    <Link href="/admin/money" className="flex items-center justify-between gap-3 px-2 py-3 rounded-md hover:bg-sunken">
                      <span><span className="pill pill-critical mr-2">Payouts paused</span>The payment processor needs: {holds.map((h) => h.title.toLowerCase()).join(", ")}</span>
                      <span className="hint">Send →</span>
                    </Link>
                  </li>
                )}
                {problems > 0 && (
                  <li>
                    <Link href="/admin/orders?show=problems" className="flex items-center justify-between gap-3 px-2 py-3 rounded-md hover:bg-sunken">
                      <span><span className="pill pill-critical mr-2">Problem</span>{problems} {problems === 1 ? "order needs" : "orders need"} you: the supplier refused or hasn't shipped</span>
                      <span className="hint">Fix →</span>
                    </Link>
                  </li>
                )}
                {held > 0 && (
                  <li>
                    <Link href="/admin/orders?show=held" className="flex items-center justify-between gap-3 px-2 py-3 rounded-md hover:bg-sunken">
                      <span><span className="pill pill-warning mr-2">On hold</span>{held} {held === 1 ? "order looked" : "orders looked"} risky and {held === 1 ? "waits" : "wait"} for you before going to the supplier</span>
                      <span className="hint">Check →</span>
                    </Link>
                  </li>
                )}
                {soldOut.length > 0 && (
                  <li>
                    <Link href="/admin/products#supplier-sold-out" className="flex items-center justify-between gap-3 px-2 py-3 rounded-md hover:bg-sunken">
                      <span><span className="pill pill-warning mr-2">Sold out</span>{soldOut.length === 1 ? `${soldOut[0]!.title} is` : `${soldOut.length} products are`} sold out at the supplier, so buyers can&apos;t order {soldOut.length === 1 ? "it" : "them"}</span>
                      <span className="hint">Check →</span>
                    </Link>
                  </li>
                )}
                {toSend > 0 && <li>
                  <Link href="/admin/orders" className="flex items-center justify-between gap-3 px-2 py-3 rounded-md hover:bg-sunken">
                    <span><span className="pill pill-warning mr-2">To send</span>{toSend} paid {toSend === 1 ? "order is" : "orders are"} waiting to be sent</span>
                    <span className="hint">Review →</span>
                  </Link>
                </li>}
              </ul>
            ) : (
              <p className="hint px-4 pb-4 pt-2">Nothing right now. Problem orders, payout holds and supplier issues will show up here.</p>
            )}
          </section>
        </div>
        {role === "owner" && <section className="card p-4 flex flex-col gap-3 self-start">
          <div>
            <h2 className="font-semibold">Set up your store</h2>
            <p className="hint">{left === 0 ? "All done." : `${left} ${left === 1 ? "step" : "steps"} left`}</p>
          </div>
          <ol className="flex flex-col gap-1">
            {steps.map((s) => (
              <li key={s.title}>
                {s.href && !s.done ? (
                  <Link href={s.href} className="flex gap-3 items-start px-2 py-2 rounded-md hover:bg-sunken">
                    <Check done={s.done} /><span className="text-sm font-medium">{s.title}</span>
                  </Link>
                ) : (
                  <div className="flex gap-3 items-start px-2 py-2">
                    <Check done={s.done} />
                    <span className={`text-sm ${s.done ? "text-muted line-through" : ""}`}>{s.title}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>}
      </div>
    </main>
  );
}

function Check({ done }: { done: boolean }) {
  return (
    <span aria-hidden className={`mt-0.5 size-4 shrink-0 rounded-full border-2 grid place-items-center ${done ? "bg-accent border-accent" : "border-border-strong"}`}>
      {done && <svg viewBox="0 0 12 12" className="size-2.5 text-accent-ink" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.2 2.2 4.8-5" /></svg>}
    </span>
  );
}
