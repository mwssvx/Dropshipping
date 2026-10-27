import Link from "next/link";
import { can, customerTags, describeTagRule, formatMoney, listCustomers, listProducts, listTagRules, MAX_TAG_RULES } from "@sf/core";
import { requireShop } from "@/lib/server";
import { deleteTagRuleAction } from "../../tag-rule-actions";
import { PageHeader } from "../PageHeader";
import { TagRuleForm } from "./TagRuleForm";

export const metadata = { title: "Customers" };

const date = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No orders yet");

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; erased?: string }> }) {
  const { shop, db, role } = await requireShop("customers");
  const { q, tag, erased } = await searchParams;
  const customers = await listCustomers(db, shop.id, { query: q, tag });
  const [tags, rules, products] = await Promise.all([customerTags(db, shop.id), listTagRules(db, shop.id), listProducts(db, shop.id)]);
  const filtered = !!(q || tag);
  const seesMoney = can(role, "money");
  const repeat = customers.filter((c) => c.orders > 1).length;
  const accounts = customers.filter((c) => c.lastSignInAt).length;

  return (
    <main className="pb-12">
      <PageHeader title="Customers" actions={<Link className="btn btn-secondary" href="/admin/blocked">Blocked buyers</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        {erased !== undefined && (
          <p className="banner banner-success" role="status">
            Their data is erased.{Number(erased) > 0 && ` ${erased} ${erased === "1" ? "order keeps" : "orders keep"} only the amounts and country for your records.`}
          </p>
        )}
        {!filtered && customers.length > 0 && (
          <p className="hint">
            {customers.length} {customers.length === 1 ? "customer" : "customers"} · {repeat} bought more than once · {accounts} signed in to their account
          </p>
        )}
        <form className="flex gap-2 max-w-md" role="search">
          <label className="sr-only" htmlFor="q">Search customers</label>
          <input className="input" id="q" name="q" type="search" defaultValue={q} placeholder="Name or email" />
          {tag && <input type="hidden" name="tag" value={tag} />}
          <button className="btn btn-secondary">Search</button>
        </form>
        {tags.length > 0 && (
          <nav aria-label="Filter by tag" className="flex flex-wrap gap-2 text-sm">
            <Link href={q ? `/admin/customers?q=${encodeURIComponent(q)}` : "/admin/customers"} className={`pill ${tag ? "pill-neutral" : "pill-info"}`} aria-current={tag ? undefined : "page"}>All</Link>
            {tags.map((t) => (
              <Link key={t.tag} href={`/admin/customers?${new URLSearchParams({ ...(q ? { q } : {}), tag: t.tag })}`}
                className={`pill ${tag === t.tag ? "pill-info" : "pill-neutral"}`} aria-current={tag === t.tag ? "page" : undefined}>
                {t.tag} <span className="hint num">{t.count}</span>
              </Link>
            ))}
          </nav>
        )}
        {customers.length > 0 && (
          <p className="text-sm">
            <a className="underline" href={`/admin/customers/export.csv${filtered ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}) })}` : ""}`} download>
              Download {filtered ? "these customers" : "all customers"} as a spreadsheet
            </a>
          </p>
        )}
        {customers.length === 0 ? (
          <div className="card p-6 hint">{q ? `No customers match "${q}".` : tag ? `Nobody is tagged "${tag}".` : "Customers show up here after their first checkout."}</div>
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
                  <th className="font-medium px-4 py-3">Emails</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/customers/${c.id}`} className="font-medium underline-offset-2 hover:underline">{c.name || c.email}</Link>
                      {c.name && <div className="hint">{c.email}</div>}
                      {c.tags.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{c.tags.map((t) => <span key={t} className="pill pill-neutral text-xs">{t}</span>)}</div>}
                    </td>
                    <td className="px-4 py-3 text-right num">{c.orders}</td>
                    {seesMoney && <td className="px-4 py-3 text-right num">{formatMoney(c.spentMinor, shop.currency)}</td>}
                    <td className="px-4 py-3 whitespace-nowrap">{date(c.lastOrderAt)}</td>
                    <td className="px-4 py-3">{c.lastSignInAt ? <span className="pill pill-success">Signed in {date(c.lastSignInAt)}</span> : <span className="hint">Guest</span>}</td>
                    <td className="px-4 py-3">{c.acceptsMarketing ? <span className="pill pill-info">Subscribed</span> : <span className="hint">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <section aria-labelledby="tag-rules-heading" id="tag-rules" className="card p-4 sm:p-6 flex flex-col gap-4 mt-4">
          <div>
            <h2 id="tag-rules-heading" className="font-semibold">Tag customers automatically</h2>
            <p className="hint text-sm">
              A rule gives its tag to every customer who matches and takes it off when they stop matching, for example after a refund.
              Use the tags to filter this list or to pick who gets an email campaign. Tags you type yourself are never taken off.
            </p>
          </div>
          {rules.length > 0 && (
            <ul className="divide-y divide-border">
              {rules.map((r) => (
                <li key={r.id} className="py-2 flex flex-wrap items-center gap-3" aria-label={`Rule for ${r.tag}`}>
                  <span className="pill pill-info">{r.tag}</span>
                  <span className="flex-1 min-w-0 text-sm">{describeTagRule(r, shop.currency, r.productTitle)}</span>
                  <Link className="hint text-sm underline" href={`/admin/customers?tag=${encodeURIComponent(r.tag)}`}>
                    {r.customers} {r.customers === 1 ? "customer" : "customers"}
                  </Link>
                  <form action={deleteTagRuleAction.bind(null, r.id)}>
                    <button className="hint hover:text-critical text-sm" aria-label={`Remove the rule for ${r.tag}`}>Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {rules.length < MAX_TAG_RULES ? (
            <TagRuleForm currency={shop.currency} products={products.map((p) => ({ id: p.id, title: p.title }))} />
          ) : (
            <p className="hint text-sm">You have {MAX_TAG_RULES} rules, the most a store can have. Remove one to add another.</p>
          )}
        </section>
      </div>
    </main>
  );
}
