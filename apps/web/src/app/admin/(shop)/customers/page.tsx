import { can, formatMoney, listCustomers } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";

export const metadata = { title: "Customers" };

const date = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No orders yet");

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { shop, db, role } = await requireShop("customers");
  const { q } = await searchParams;
  const customers = await listCustomers(db, shop.id, { query: q });
  const seesMoney = can(role, "money");
  const repeat = customers.filter((c) => c.orders > 1).length;
  const accounts = customers.filter((c) => c.lastSignInAt).length;

  return (
    <main className="pb-12">
      <PageHeader title="Customers" />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        {!q && customers.length > 0 && (
          <p className="hint">
            {customers.length} {customers.length === 1 ? "customer" : "customers"} · {repeat} bought more than once · {accounts} signed in to their account
          </p>
        )}
        <form className="flex gap-2 max-w-md" role="search">
          <label className="sr-only" htmlFor="q">Search customers</label>
          <input className="input" id="q" name="q" type="search" defaultValue={q} placeholder="Name or email" />
          <button className="btn btn-secondary">Search</button>
        </form>
        {customers.length === 0 ? (
          <div className="card p-6 hint">{q ? `No customers match "${q}".` : "Customers show up here after their first checkout."}</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left hint border-b border-border">
                <tr>
                  <th className="font-medium px-4 py-3">Customer</th>
                  <th className="font-medium px-4 py-3 text-right">Orders</th>
                  {seesMoney && <th className="font-medium px-4 py-3 text-right">Spent</th>}
                  <th className="font-medium px-4 py-3">Last order</th>
                  <th className="font-medium px-4 py-3">Account</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.name || c.email}</div>
                      {c.name && <div className="hint">{c.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-right num">{c.orders}</td>
                    {seesMoney && <td className="px-4 py-3 text-right num">{formatMoney(c.spentMinor, shop.currency)}</td>}
                    <td className="px-4 py-3 whitespace-nowrap">{date(c.lastOrderAt)}</td>
                    <td className="px-4 py-3">{c.lastSignInAt ? <span className="pill pill-success">Signed in {date(c.lastSignInAt)}</span> : <span className="hint">Guest</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
