import Link from "next/link";
import { notFound } from "next/navigation";
import { can, creditFor, customerPoints, formatMoney, getCustomerProfile, NotFoundError, personalCodesFor, RETURN_REASON_LABELS } from "@sf/core";
import { FulfilmentStatus, PaymentStatus } from "@/components/Status";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { EraseForm, NotesForm, PersonalCodeForm } from "./CustomerForms";
import { AdjustPointsForm } from "../../rewards/RewardsForms";

export const metadata = { title: "Customer" };

const date = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { shop, db, role } = await requireShop("customers");
  const { id } = await params;
  let profile;
  try {
    profile = await getCustomerProfile(db, shop.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { customer, stats, orders } = profile;
  const seesMoney = can(role, "money");
  const money = (m: number) => formatMoney(m, shop.currency);
  const points = await customerPoints(db, customer.id);
  const marketing = can(role, "marketing");
  const codes = marketing ? await personalCodesFor(db, shop.id, customer.email) : [];
  const off = (c: (typeof codes)[number]) => (c.kind === "percent" ? `${c.value}% off` : `${money(c.value)} off`);

  return (
    <main className="pb-12">
      <PageHeader title={customer.name || customer.email} back={<Link href="/admin/customers" className="hint hover:text-ink">← Customers</Link>} />
      <div className="px-4 sm:px-8 grid lg:grid-cols-[1fr_20rem] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4" aria-label="Summary">
            <Stat label="Orders" value={String(stats.orders)} />
            {seesMoney && <Stat label="Spent" value={money(stats.spentMinor)} />}
            {seesMoney && <Stat label="Average order" value={stats.orders ? money(stats.averageMinor) : "—"} />}
            <Stat label="Customer since" value={date(stats.firstOrderAt ?? customer.createdAt)} />
          </section>

          <section className="card overflow-x-auto" aria-labelledby="orders-h">
            <h2 id="orders-h" className="font-semibold px-5 pt-4 pb-2">Orders</h2>
            {orders.length === 0 ? (
              <p className="hint px-5 pb-4">
                No orders yet.{profile.unpaidCheckouts > 0 && ` They started ${profile.unpaidCheckouts === 1 ? "a checkout" : `${profile.unpaidCheckouts} checkouts`} without paying.`}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left hint border-b border-border">
                  <tr>
                    <th className="font-medium px-5 py-2">Order</th>
                    <th className="font-medium px-3 py-2">Date</th>
                    <th className="font-medium px-3 py-2">Payment</th>
                    <th className="font-medium px-3 py-2">Delivery</th>
                    <th className="font-medium px-3 py-2 text-right">Items</th>
                    {seesMoney && <th className="font-medium px-5 py-2 text-right">Total</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="px-5 py-2"><Link href={`/admin/orders/${o.id}`} className="underline">#{o.number}</Link></td>
                      <td className="px-3 py-2 whitespace-nowrap">{date(o.paidAt)}</td>
                      <td className="px-3 py-2"><PaymentStatus value={o.paymentStatus} /></td>
                      <td className="px-3 py-2"><FulfilmentStatus value={o.fulfillmentStatus} /></td>
                      <td className="px-3 py-2 text-right num">{o.items}</td>
                      {seesMoney && <td className="px-5 py-2 text-right num">{formatMoney(o.totalMinor, o.currency)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {profile.returns.length > 0 && (
            <section className="card p-5 flex flex-col gap-2" aria-labelledby="returns-h">
              <h2 id="returns-h" className="font-semibold">Returns</h2>
              <ul className="text-sm flex flex-col gap-1">
                {profile.returns.map((r) => (
                  <li key={r.id}>
                    Order #{r.orderNumber}: {RETURN_REASON_LABELS[r.reason].toLowerCase()} <span className="hint">· {r.status} · {date(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {can(role, "privacy") && (
            <section className="card p-5 flex flex-col gap-3" aria-labelledby="privacy-h">
              <h2 id="privacy-h" className="font-semibold">Privacy requests</h2>
              <p className="text-sm hint">
                Buyers can ask what you hold about them, or ask you to erase it (GDPR in the EU and UK, CCPA in California). Answer within a month.
              </p>
              <a href={`/admin/customers/${customer.id}/data.json`} className="btn btn-secondary self-start">Download their data</a>
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Erase their data on request</summary>
                <div className="flex flex-col gap-3 pt-3">
                  <p className="hint">
                    Their name, email, street address, messages and email history are removed for good, and they&apos;re taken off your lists. Orders stay in your
                    sales and tax records with only the country, region and postcode. Orders still on their way need to be finished or refunded first.
                  </p>
                  <EraseForm id={customer.id} email={customer.email} />
                </div>
              </details>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="card p-5 flex flex-col gap-2 text-sm" aria-labelledby="contact-h">
            <h2 id="contact-h" className="font-semibold">Contact</h2>
            <a href={`mailto:${customer.email}`} className="underline break-all">{customer.email}</a>
            <p>{customer.acceptsMarketing ? <span className="pill pill-info">Subscribed to emails</span> : <span className="hint">Not subscribed to emails</span>}</p>
            <p className="hint">{customer.lastSignInAt ? `Signed in to their account ${date(customer.lastSignInAt)}` : "Checks out as a guest"}</p>
            {customer.wholesaleStatus === "approved" && <p><span className="pill pill-success">Wholesale</span> {customer.wholesaleCompany}</p>}
            {profile.storeCreditMinor > 0 && <p>Store credit: <span className="num font-medium">{money(profile.storeCreditMinor)}</span></p>}
          </section>
          {(shop.rewardsEnabled || points !== 0) && (
            <section className="card p-5 flex flex-col gap-3 text-sm" aria-labelledby="points-h">
              <h2 id="points-h" className="font-semibold">Rewards</h2>
              <p><span className="num font-medium">{points.toLocaleString("en-US")} points</span>{points >= 100 && <span className="hint"> · worth {money(creditFor(shop, points))}</span>}</p>
              <AdjustPointsForm customerId={customer.id} />
            </section>
          )}
          {profile.addresses.length > 0 && (
            <section className="card p-5 flex flex-col gap-3 text-sm" aria-labelledby="addresses-h">
              <h2 id="addresses-h" className="font-semibold">{profile.addresses.length === 1 ? "Address" : "Addresses"}</h2>
              {profile.addresses.slice(0, 3).map((a, i) => (
                <address key={i} className="not-italic">
                  {a.name}<br />{a.line1}{a.line2 ? <>, {a.line2}</> : null}<br />{a.city}{a.region ? `, ${a.region}` : ""} {a.postalCode}<br />{a.country}
                </address>
              ))}
            </section>
          )}
          {marketing && (
            <section className="card p-5 flex flex-col gap-3 text-sm" aria-labelledby="code-h">
              <h2 id="code-h" className="font-semibold">Send a code</h2>
              <PersonalCodeForm id={customer.id} currency={shop.currency} />
              {codes.length > 0 && (
                <ul className="flex flex-col gap-1 border-t border-border pt-3" aria-label="Codes sent">
                  {codes.map((c) => (
                    <li key={c.id} className="flex flex-wrap justify-between gap-2">
                      <span><span className="font-mono">{c.code}</span> · {off(c)}</span>
                      <span className="hint">
                        {c.status === "used" ? `Used on #${c.orderNumber}` : c.status === "expired" ? "Expired" : `Until ${date(c.endsAt)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <section className="card p-5" aria-label="Note and tags">
            <NotesForm id={customer.id} note={customer.note ?? ""} tags={customer.tags.join(", ")} />
            {customer.autoTags.length > 0 && (
              <p className="hint text-sm mt-2">
                From a <Link className="underline" href="/admin/customers#tag-rules">tag rule</Link>: {customer.autoTags.join(", ")}. It stays while they match the rule.
              </p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="hint text-sm">{label}</span>
      <span className="font-semibold num">{value}</span>
    </div>
  );
}
