import Link from "next/link";
import { can, CUSTOMER_PAGE_SIZE, customerTags, customerTotals, describeTagRule, formatMoney, listCustomers, listTagRules, productChoices, MAX_TAG_RULES } from "@sf/core";
import { requireShop } from "@/lib/server";
import { deleteTagRuleAction } from "../../tag-rule-actions";
import { PageHeader } from "../PageHeader";
import { TagRuleForm } from "./TagRuleForm";

export const metadata = { title: "Customers" };

const date = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No orders yet");

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; erased?: string; page?: string }> }) {
  const { shop, db, role } = await requireShop("customers");
  const { q, tag, erased, page: pageParam } = await searchParams;
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(pageParam)) || 1));
  const [customers, totals, tags, rules, products] = await Promise.all([
    listCustomers(db, shop.id, { query: q, tag, limit: CUSTOMER_PAGE_SIZE, offset: (page - 1) * CUSTOMER_PAGE_SIZE }),
    customerTotals(db, shop.id, { query: q, tag }),
    customerTags(db, shop.id),
    listTagRules(db, shop.id),
    productChoices(db, shop.id),
  ]);
  const filtered = !!(q || tag);
  const seesMoney = can(role, "money");
  const pages = Math.ceil(totals.customers / CUSTOMER_PAGE_SIZE);
  const pageHref = (n: number) => {
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}), ...(n > 1 ? { page: String(n) } : {}) });
    return params.size ? `/admin/customers?${params}` : "/admin/customers";
  };
  const first = (page - 1) * CUSTOMER_PAGE_SIZE + 1;

  return (
    <main className="pb-12">
      <PageHeader title="Customers" actions={<Link className="btn btn-secondary" href="/admin/blocked">Blocked buyers</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        {erased !== undefined && (
          <p className="banner banner-success" role="status">
            Their data is erased.{Number(erased) > 0 && ` ${erased} ${erased === "1" ? "order keeps" : "orders keep"} only the amounts and country for your records.`}
          </p>
        )}
        {!filtered && totals.customers > 0 && (
          <p className="hint">
            {totals.customers.toLocaleString("en-US")} {totals.customers === 1 ? "customer" : "customers"} · {totals.repeat.toLocaleString("en-US")} bought more than once · {totals.accounts.toLocaleString("en-US")} signed in to their account
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
        {totals.customers > 0 && (
          <p className="text-sm">
            <a className="underline" href={`/admin/customers/export.csv${filtered ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}) })}` : ""}`} download>
              Download {filtered ? "these customers" : "all customers"} as a spreadsheet
            </a>
          </p>
        )}
        {customers.length === 0 && page > 1 ? (
          <div className="card p-6 hint">There are no more customers. <Link href={pageHref(1)} className="underline">Back to the first page</Link></div>
        ) : customers.length === 0 ? (
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
        {pages > 1 && customers.length > 0 && (
          <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
            {page > 1 && <Link href={pageHref(page - 1)} className="btn btn-secondary">← Previous</Link>}
            <span className="hint num">{first.toLocaleString("en-US")} to {(first + customers.length - 1).toLocaleString("en-US")} of {totals.customers.toLocaleString("en-US")}</span>
            {page < pages && <Link href={pageHref(page + 1)} className="btn btn-secondary ml-auto">Next →</Link>}
          </nav>
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
