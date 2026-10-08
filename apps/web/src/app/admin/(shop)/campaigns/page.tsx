import Link from "next/link";
import { audienceSizes, campaignAllowance, formatMoney, listCampaigns } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { MailingAddressForm } from "./CampaignForms";

export const metadata = { title: "Email campaigns" };

const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

export default async function CampaignsPage() {
  const { shop, db } = await requireShop("marketing");
  const [rows, sizes, allowance] = await Promise.all([listCampaigns(db, shop.id), audienceSizes(db, shop.id), campaignAllowance(db, shop.id)]);
  const money = (m: number) => formatMoney(m, shop.currency);

  return (
    <main className="pb-12">
      <PageHeader
        title="Email campaigns"
        back={<Link href="/admin/marketing" className="hint hover:text-ink">← Marketing</Link>}
        actions={<Link href="/admin/campaigns/new" className="btn btn-primary">New campaign</Link>}
      />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="card p-4"><dt className="hint">Subscribers</dt><dd className="text-2xl font-semibold num">{sizes.subscribers}</dd></div>
          <div className="card p-4"><dt className="hint">Emails left this month</dt><dd className="text-2xl font-semibold num">{allowance.left.toLocaleString("en-US")}</dd></div>
          <div className="card p-4 col-span-2 sm:col-span-1"><dt className="hint">Cost</dt><dd className="text-sm pt-1">Free, up to {allowance.limit.toLocaleString("en-US")} emails a month on every plan.</dd></div>
        </dl>
        <p className="hint">
          Buyers join your list by ticking &quot;Send me news and offers&quot; at checkout or on their account page. Every email has a one-click
          unsubscribe, and orders from people who clicked within a week count toward the campaign.
        </p>

        <section className="card overflow-hidden" aria-labelledby="campaigns-heading">
          <h2 id="campaigns-heading" className="sr-only">Campaigns</h2>
          {rows.length ? (
            <ul className="divide-y divide-border">
              {rows.map((c) => (
                <li key={c.id} className="p-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Link href={`/admin/campaigns/${c.id}`} className="font-medium hover:underline flex-1 min-w-48">{c.subject}</Link>
                  <span className={`pill ${c.status === "sent" ? "pill-success" : c.status === "draft" ? "pill-neutral" : "pill-info"}`}>
                    {c.status === "sent" ? "Sent" : c.status === "draft" ? "Draft" : c.status === "scheduled" ? `Scheduled ${date(c.scheduledFor!)}` : "Sending"}
                  </span>
                  {c.status !== "draft" && (
                    <span className="hint num w-full">
                      {c.stats.sent} sent · {pct(c.stats.clicks, c.stats.sent)} clicked · {c.stats.orders} {c.stats.orders === 1 ? "order" : "orders"} · {money(c.stats.salesMinor)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-5 hint">No campaigns yet. A short note about something new, with one link, works best.</p>
          )}
        </section>

        <section className="card p-5" aria-label="Mailing address">
          <MailingAddressForm value={shop.mailingAddress} />
        </section>
      </div>
    </main>
  );
}
