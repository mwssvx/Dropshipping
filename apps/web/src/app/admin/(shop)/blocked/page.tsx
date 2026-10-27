import Link from "next/link";
import { listBlockedBuyers } from "@sf/core";
import { requireShop } from "@/lib/server";
import { unblockAction } from "../../blocked-actions";
import { PageHeader } from "../PageHeader";
import { BlockEmailForm } from "./BlockEmailForm";

export const metadata = { title: "Blocked buyers" };

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function BlockedPage() {
  const { shop, db } = await requireShop("customers");
  const blocked = await listBlockedBuyers(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="Blocked buyers" actions={<Link className="btn btn-secondary" href="/admin/customers">Customers</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        <p className="text-muted">
          Buyers behind chargebacks, stolen cards or return abuse can&apos;t check out again, by email or delivery address. They see &quot;We can&apos;t take
          this order&quot; before paying, so they can&apos;t cost you another dispute fee. Block a buyer from their order, or type an email here.
        </p>
        <section className="card p-5" aria-label="Block an email">
          <BlockEmailForm />
        </section>
        <section className="card overflow-x-auto" aria-labelledby="blocked-list">
          <h2 id="blocked-list" className="font-semibold px-5 pt-4 pb-2">{blocked.length === 1 ? "1 blocked" : `${blocked.length} blocked`}</h2>
          {blocked.length ? (
            <table className="table">
              <thead><tr><th>Email or address</th><th>Why</th><th>Since</th><th><span className="sr-only">Unblock</span></th></tr></thead>
              <tbody>
                {blocked.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <span className="pill pill-neutral mr-2">{b.kind === "email" ? "Email" : "Address"}</span>
                      <span className="break-all">{b.label}</span>
                    </td>
                    <td className="hint">{b.note ?? "—"}{b.orderId && <> · <Link href={`/admin/orders/${b.orderId}`} className="underline">order</Link></>}</td>
                    <td className="hint whitespace-nowrap">{day.format(b.createdAt)}</td>
                    <td className="text-right">
                      <form action={unblockAction.bind(null, b.id)}>
                        <button type="submit" className="btn btn-sm btn-secondary" aria-label={`Unblock ${b.label}`}>Unblock</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 pb-5 hint">Nobody is blocked.</p>
          )}
        </section>
      </div>
    </main>
  );
}
