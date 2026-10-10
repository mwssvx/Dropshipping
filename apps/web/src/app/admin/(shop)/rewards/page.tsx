import Link from "next/link";
import { describeRewards, formatMoney, rewardsSummary } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { RewardsSettingsForm } from "./RewardsForms";

export const metadata = { title: "Rewards" };

export default async function RewardsPage() {
  const { shop, db } = await requireShop("marketing");
  const summary = await rewardsSummary(db, shop);
  const money = (m: number) => formatMoney(m, shop.currency);
  return (
    <main className="pb-12">
      <PageHeader title="Rewards" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="hint max-w-2xl">
          Buyers earn points on what they pay for goods and swap them for store credit on their account page, so they come back. Points are taken back
          when an order is refunded. Wholesale orders and gift cards don&apos;t earn points. You can add or take points on a customer&apos;s page.
        </p>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="settings-heading">
          <h2 id="settings-heading" className="font-semibold">Settings</h2>
          <RewardsSettingsForm enabled={shop.rewardsEnabled} earnRate={shop.rewardsEarnRate} value={(shop.rewardsValueMinor / 100).toFixed(2)} currency={shop.currency} />
          <p className="hint text-sm">Buyers see: {describeRewards(shop)}</p>
        </section>
        <section className="card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4" aria-label="Summary">
          <Stat label="Buyers with points" value={summary.members.toLocaleString("en-US")} />
          <Stat label="Points held" value={summary.points.toLocaleString("en-US")} />
          <Stat label="Worth if all swapped" value={money(summary.owedMinor)} />
          <Stat label="Points swapped so far" value={summary.redeemedPoints.toLocaleString("en-US")} />
        </section>
        <section className="card overflow-x-auto" aria-labelledby="top-heading">
          <h2 id="top-heading" className="font-semibold px-5 pt-4 pb-2">Most points</h2>
          {summary.top.length === 0 ? (
            <p className="hint px-5 pb-4">No one has points yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {summary.top.map((r) => (
                  <tr key={r.customerId}>
                    <td className="px-5 py-2"><Link className="underline" href={`/admin/customers/${r.customerId}`}>{r.name || r.email}</Link></td>
                    <td className="px-5 py-2 text-right num">{r.points.toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="hint text-sm">{label}</span>
      <span className="text-xl font-semibold num">{value}</span>
    </div>
  );
}
