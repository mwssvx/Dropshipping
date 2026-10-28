import Link from "next/link";
import { can, countryName, CUSTOMER_FILTERS, CUSTOMER_PAGE_SIZE, CUSTOMER_SORTS, LAPSED_DAYS, customerCountries, customerTags, customerTotals, describeTagRule, formatMoney, listCustomers, listSavedViews, listTagRules, productChoices, MAX_TAG_RULES, CUSTOMER_SPENT, spentParam } from "@sf/core";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { SavedViews } from "@/components/SavedViews";
import { requireShop } from "@/lib/server";
import { deleteTagRuleAction } from "../../tag-rule-actions";
import { PageHeader } from "../PageHeader";
import { TagEveryoneForm } from "./TagEveryoneForm";
import { TagRuleForm } from "./TagRuleForm";

export const metadata = { title: "Customers" };

const SORTS = [
  ["recent", "Last order"],
  ["spent", "Most spent"],
  ["orders", "Most orders"],
  ["newest", "Newest customers"],
  ["name", "Name A to Z"],
] as const;

const FILTERS = [
  ["subscribed", "Subscribed to emails"],
  ["repeat", "Bought more than once"],
  ["lapsed", `No order in ${LAPSED_DAYS} days`],
  ["never", "Never bought"],
] as const;

const date = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No orders yet");

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; filter?: string; country?: string; code?: string; product?: string; spent?: string; sort?: string; erased?: string; page?: string }> }) {
  const { shop, db, role } = await requireShop("customers");
  const { q, tag, filter: filterParam, country: countryParam, code: codeParam, product: productParam, spent: spentValue, sort: sortParam, erased, page: pageParam } = await searchParams;
  const filter = CUSTOMER_FILTERS.find((f) => f === filterParam);
  const country = /^[A-Z]{2}$/.test(countryParam ?? "") ? countryParam : undefined;
  const discountId = /^[0-9a-f-]{36}$/i.test(codeParam ?? "") ? codeParam : undefined;
  const productId = /^[0-9a-f-]{36}$/i.test(productParam ?? "") ? productParam : undefined;
  const seesMoney = can(role, "money");
  // Like the "Most spent" sort, only for staff who see money.
  const spent = seesMoney ? spentParam(spentValue) : undefined;
  // Staff who can't see money can't rank customers by it either. The default is left out of links.
  const sorts = SORTS.filter(([s]) => seesMoney || s !== "spent");
  const sort = CUSTOMER_SORTS.find((s) => s === sortParam && s !== "recent" && sorts.some(([x]) => x === s));
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(pageParam)) || 1));
  const [customers, totals, tags, rules, products, views, countries, discount, bought] = await Promise.all([
    listCustomers(db, shop.id, { query: q, tag, filter, country, discountId, productId, minSpentMinor: spent, sort, limit: CUSTOMER_PAGE_SIZE, offset: (page - 1) * CUSTOMER_PAGE_SIZE }),
    customerTotals(db, shop.id, { query: q, tag, filter, country, discountId, productId, minSpentMinor: spent }),
    customerTags(db, shop.id),
    listTagRules(db, shop.id),
    productChoices(db, shop.id),
    listSavedViews(db, shop.id, "customers"),
    customerCountries(db, shop.id),
    discountId ? db.query.discounts.findFirst({ where: (d, { and, eq }) => and(eq(d.id, discountId), eq(d.shopId, shop.id)), columns: { id: true, code: true } }) : null,
    productId ? db.query.products.findFirst({ where: (p, { and, eq }) => and(eq(p.id, productId), eq(p.shopId, shop.id)), columns: { id: true, title: true } }) : null,
  ]);
  const filtered = !!(q || tag || filter || country || discountId || productId || spent);
  /** A link to the list with some of the search, tag, filter and sort changed; a change goes back to page 1. */
  const listHref = (next: { q?: string; tag?: string; filter?: string; country?: string; code?: string; product?: string; spent?: string; sort?: string; page?: number }) => {
    const merged = { q, tag, filter, country, code: discountId, product: productId, spent: spent ? String(spent) : undefined, sort, ...next, page: next.page && next.page > 1 ? String(next.page) : undefined };
    const params = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => !!e[1]));
    return params.size ? `/admin/customers?${params}` : "/admin/customers";
  };
  const pages = Math.ceil(totals.customers / CUSTOMER_PAGE_SIZE);
  const pageHref = (n: number) => listHref({ page: n });
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
        <SavedViews list="customers" views={views} params={{ q, tag, filter, country, code: discountId, product: productId, spent: spent ? String(spent) : undefined, sort }} />
        <form className="flex flex-wrap gap-2 max-w-2xl" role="search">
          <label className="sr-only" htmlFor="q">Search customers</label>
          <input className="input flex-1 min-w-40" id="q" name="q" type="search" defaultValue={q} placeholder="Name or email" />
          {tag && <input type="hidden" name="tag" value={tag} />}
          {filter && <input type="hidden" name="filter" value={filter} />}
          {discountId && <input type="hidden" name="code" value={discountId} />}
          {productId && <input type="hidden" name="product" value={productId} />}
          <button className="btn btn-secondary">Search</button>
          {(countries.length > 1 || country) && <AutoSubmitSelect id="customer-country" name="country" label="Bought for delivery to" value={country ?? ""} options={[["", "Every country"], ...countries.map((c) => [c.country, `${countryName(c.country)} (${c.count.toLocaleString("en-US")})`] as const)]} />}
          {seesMoney && <AutoSubmitSelect id="customer-spent" name="spent" label="Spent at least" value={spent ? String(spent) : ""} options={[["", "Any amount"], ...CUSTOMER_SPENT.map((n) => [String(n), `${formatMoney(n, shop.currency)} or more`] as const)]} />}
          <AutoSubmitSelect id="customer-sort" label="Sort customers" value={sort ?? "recent"} options={sorts} />
        </form>
        {discountId && (
          <p className="text-sm flex flex-wrap items-center gap-2">
            <span>Customers who used <strong className="font-mono">{discount?.code ?? "a deleted code"}</strong></span>
            <Link href={listHref({ code: undefined })} className="underline">Show all customers</Link>
          </p>
        )}
        {productId && (
          <p className="text-sm flex flex-wrap items-center gap-2">
            <span>Customers who bought <strong>{bought?.title ?? "a deleted product"}</strong></span>
            <Link href={listHref({ product: undefined })} className="underline">Show everyone</Link>
          </p>
        )}
        {(filtered || totals.customers > 0) && <nav aria-label="Show customers" className="flex flex-wrap gap-2 text-sm">
          <Link href={listHref({ filter: undefined })} className={`pill ${filter ? "pill-neutral" : "pill-info"}`} aria-current={filter ? undefined : "page"}>Everyone</Link>
          {FILTERS.map(([f, label]) => (
            <Link key={f} href={listHref({ filter: f })} className={`pill ${filter === f ? "pill-info" : "pill-neutral"}`} aria-current={filter === f ? "page" : undefined}>{label}</Link>
          ))}
        </nav>}
        {filtered && totals.customers > 0 && <p className="hint">{totals.customers.toLocaleString("en-US")} {totals.customers === 1 ? "customer" : "customers"}</p>}
        {tags.length > 0 && (
          <nav aria-label="Filter by tag" className="flex flex-wrap gap-2 text-sm">
            <Link href={listHref({ tag: undefined })} className={`pill ${tag ? "pill-neutral" : "pill-info"}`} aria-current={tag ? undefined : "page"}>All</Link>
            {tags.map((t) => (
              <Link key={t.tag} href={listHref({ tag: t.tag })}
                className={`pill ${tag === t.tag ? "pill-info" : "pill-neutral"}`} aria-current={tag === t.tag ? "page" : undefined}>
                {t.tag} <span className="hint num">{t.count}</span>
              </Link>
            ))}
          </nav>
        )}
        {/* Kept when a change empties a filtered list, so its result still shows. */}
        {(filtered || totals.customers > 0) && (
          <details className="text-sm">
            <summary className="cursor-pointer underline w-fit">Tag {filtered ? "these customers" : "all customers"}</summary>
            <TagEveryoneForm count={totals.customers} q={q} tag={tag} filter={filter} country={country} code={discountId} product={productId} spent={spent} tags={tags.map((t) => t.tag)} />
          </details>
        )}
        {totals.customers > 0 && (
          <p className="text-sm">
            <a className="underline" href={`/admin/customers/export.csv${filtered ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}), ...(filter ? { filter } : {}), ...(country ? { country } : {}), ...(discountId ? { code: discountId } : {}), ...(productId ? { product: productId } : {}), ...(spent ? { spent: String(spent) } : {}) })}` : ""}`} download>
              Download {filtered ? "these customers" : "all customers"} as a spreadsheet
            </a>
          </p>
        )}
        {customers.length === 0 && page > 1 ? (
          <div className="card p-6 hint">There are no more customers. <Link href={pageHref(1)} className="underline">Back to the first page</Link></div>
        ) : customers.length === 0 ? (
          <div className="card p-6 hint">{q ? `No customers match "${q}".` : tag ? `Nobody is tagged "${tag}"${filter ? " in this view" : ""}.` : filter ? "No customers here yet." : country ? `Nobody has bought for delivery to ${countryName(country)} yet.` : "Customers show up here after their first checkout."}</div>
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
