import Link from "next/link";
import { BANK_DETAILS_MAX, BUYER_EDIT_HOURS, can, countOrders, countryName, formatMoney, listSavedViews, orderCountries, orderPage, orderTags, ORDER_PLACED_DAYS, placedSince, fulfillmentParam, paymentParam, RISK_HOLD_LABELS, TRANSFER_DAYS, ORDER_TOTALS, totalParam, type OrderTotalRange, buyerParam } from "@sf/core";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { SavedViews } from "@/components/SavedViews";
import { requireShop } from "@/lib/server";
import { FULFILMENT, FulfilmentStatus, PAYMENT, PaymentStatus } from "@/components/Status";
import { PageHeader } from "../PageHeader";
import { BuyerCancelForm } from "./BuyerCancelForm";
import { RiskHoldForm } from "./RiskHoldForm";
import { BankTransferForm } from "./BankTransferForm";
import { TrackingImportForm } from "./TrackingImportForm";
import { SelectAll } from "./SelectAll";
import { bulkOrdersAction } from "../../bulk-order-actions";

export const metadata = { title: "Orders" };

/** "Under $25.00", "$25.00 to $100.00", "$250.00 or more", in the store's currency. */
function totalLabel(range: OrderTotalRange, currency: string) {
  const [min, max] = ORDER_TOTALS[range];
  const from = min === null ? null : formatMoney(min, currency);
  const to = max === null ? null : formatMoney(max, currency);
  return from && to ? `${from} to ${to}` : to ? `Under ${to}` : `${from} or more`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string; tag?: string; product?: string; country?: string; code?: string; total?: string; buyer?: string; placed?: string; status?: string; payment?: string; bulk?: string; before?: string }> }) {
  const { show, q, tag, product: productParam, country: countryParam, code: codeParam, total: totalValue, buyer: buyerValue, placed: placedParam, status: statusParam, payment: paymentParamValue, bulk, before: beforeParam } = await searchParams;
  const productId = /^[0-9a-f-]{36}$/i.test(productParam ?? "") ? productParam : undefined;
  const country = /^[A-Z]{2}$/.test(countryParam ?? "") ? countryParam : undefined;
  const discountId = /^[0-9a-f-]{36}$/i.test(codeParam ?? "") ? codeParam : undefined;
  const before = /^\d{1,9}$/.test(beforeParam ?? "") ? Number(beforeParam) : undefined;
  const from = placedSince(placedParam);
  const placed = from ? placedParam : undefined;
  // "problem" has its own tab.
  const status = fulfillmentParam(statusParam) === "problem" ? undefined : fulfillmentParam(statusParam);
  const payment = paymentParam(paymentParamValue);
  const total = totalParam(totalValue);
  const buyer = buyerParam(buyerValue);
  const problemsOnly = show === "problems";
  const heldOnly = show === "held";
  const transfersOnly = show === "transfers";
  const { shop, db, role } = await requireShop("orders");
  const [{ orders, older }, problems, held, transfers, tags, countries, product, views, discount] = await Promise.all([
    orderPage(db, shop.id, { ...(problemsOnly ? { fulfillmentStatus: "problem" as const } : heldOnly ? { held: true } : transfersOnly ? { transfer: true } : {}), ...(status && !problemsOnly ? { fulfillmentStatus: status } : {}), paymentStatus: payment, query: q, tag, productId, country, discountId, total, buyer, from }, { before }),
    countOrders(db, shop.id, { fulfillmentStatus: "problem" }),
    countOrders(db, shop.id, { held: true }),
    countOrders(db, shop.id, { transfer: true }),
    orderTags(db, shop.id),
    orderCountries(db, shop.id),
    productId ? db.query.products.findFirst({ where: (p, { and, eq }) => and(eq(p.id, productId), eq(p.shopId, shop.id)), columns: { id: true, title: true } }) : null,
    listSavedViews(db, shop.id, "orders"),
    discountId ? db.query.discounts.findFirst({ where: (d, { and, eq }) => and(eq(d.id, discountId), eq(d.shopId, shop.id)), columns: { id: true, code: true } }) : null,
  ]);
  // On hold the same way the On hold tab counts it: held for the risk check and not refunded.
  const onHold = (o: (typeof orders)[number]) => !!o.heldAt && (o.paymentStatus === "paid" || o.paymentStatus === "partially_refunded");
  const filtered = !!(q || tag || productId || country || discountId || total || buyer || placed || status || payment);
  // Keeps the other filters when one changes.
  const href = (next: { show?: string; q?: string; tag?: string; product?: string; country?: string; code?: string; total?: string; buyer?: string; placed?: string; status?: string; payment?: string; before?: string }) => {
    const params = new URLSearchParams(Object.entries({ show, q, tag, product: productId, country, code: discountId, total, buyer, placed, status, payment, ...next }).filter((e): e is [string, string] => !!e[1]));
    return params.size ? `/admin/orders?${params}` : "/admin/orders";
  };
  return (
    <main className="pb-12">
      <PageHeader title="Orders" actions={<><Link href="/admin/orders/abandoned" className="btn btn-secondary">Abandoned checkouts</Link><Link href="/admin/orders/packing-slips" className="btn btn-secondary">Packing slips</Link><Link href="/admin/orders/new" className="btn btn-secondary">Create payment link</Link></>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4">
        <nav className="flex gap-1" aria-label="Order filters">
          <Link href={href({ show: undefined })} className={`chip text-sm ${!problemsOnly && !heldOnly && !transfersOnly ? "font-semibold border-accent" : ""}`} aria-current={!problemsOnly && !heldOnly && !transfersOnly ? "page" : undefined}>All</Link>
          <Link href={href({ show: "problems" })} className={`chip text-sm ${problemsOnly ? "font-semibold border-accent" : ""}`} aria-current={problemsOnly ? "page" : undefined}>
            Needs attention {problems > 0 && <span className="pill pill-critical">{problems}</span>}
          </Link>
          <Link href={href({ show: "held" })} className={`chip text-sm ${heldOnly ? "font-semibold border-accent" : ""}`} aria-current={heldOnly ? "page" : undefined}>
            On hold {held > 0 && <span className="pill pill-warning">{held}</span>}
          </Link>
          <Link href={href({ show: "transfers" })} className={`chip text-sm ${transfersOnly ? "font-semibold border-accent" : ""}`} aria-current={transfersOnly ? "page" : undefined}>
            Bank transfers {transfers > 0 && <span className="pill pill-info">{transfers}</span>}
          </Link>
        </nav>
        <SavedViews list="orders" views={views} params={{ show: problemsOnly || heldOnly || transfersOnly ? show : undefined, q, tag, product: productId, country, code: discountId, total, buyer, placed, status, payment }} />
        <form className="flex flex-wrap gap-2 max-w-4xl" role="search">
          <label className="sr-only" htmlFor="q">Search orders</label>
          <input className="input flex-1 min-w-40" id="q" name="q" type="search" defaultValue={q} placeholder="Order number, name or email" />
          {show && <input type="hidden" name="show" value={show} />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          {productId && <input type="hidden" name="product" value={productId} />}
          {discountId && <input type="hidden" name="code" value={discountId} />}
          {countries.length > 1 && <AutoSubmitSelect id="order-country" name="country" label="Ship-to country" value={country ?? ""} options={[["", "Every country"], ...countries.map((c) => [c.country, `${countryName(c.country)} (${c.count.toLocaleString("en-US")})`] as const)]} />}
          {!problemsOnly && <AutoSubmitSelect id="order-status" name="status" label="Delivery status" value={status ?? ""} options={[["", "Any delivery status"], ...Object.entries(FULFILMENT).filter(([k]) => k !== "problem").map(([k, [label]]) => [k, label] as const)]} />}
          <AutoSubmitSelect id="order-payment" name="payment" label="Payment status" value={payment ?? ""} options={[["", "Any payment status"], ...Object.entries(PAYMENT).map(([k, [label]]) => [k, label] as const)]} />
          <AutoSubmitSelect id="order-total" name="total" label="Order total" value={total ?? ""} options={[["", "Any total"], ...(Object.keys(ORDER_TOTALS) as OrderTotalRange[]).map((k) => [k, totalLabel(k, shop.currency)] as const)]} />
          <AutoSubmitSelect id="order-buyer" name="buyer" label="New or returning buyers" value={buyer ?? ""} options={[["", "Every buyer"], ["new", "First orders"], ["returning", "Returning buyers"]]} />
          <AutoSubmitSelect id="order-placed" name="placed" label="Placed in" value={placed ?? ""} options={[["", "Any time"], ...ORDER_PLACED_DAYS.map((d) => [String(d), d === 365 ? "The last 12 months" : `The last ${d} days`] as const)]} />
          <button className="btn btn-secondary">Search</button>
        </form>
        {productId && (
          <p className="text-sm flex flex-wrap items-center gap-2">
            <span>Orders with <strong>{product?.title ?? "a deleted product"}</strong></span>
            <Link href={href({ product: undefined })} className="underline">Show all orders</Link>
          </p>
        )}
        {discountId && (
          <p className="text-sm flex flex-wrap items-center gap-2">
            <span>Orders that used <strong className="font-mono">{discount?.code ?? "a deleted code"}</strong></span>
            <Link href={href({ code: undefined })} className="underline">Show all orders</Link>
          </p>
        )}
        {tags.length > 0 && (
          <nav aria-label="Filter by tag" className="flex flex-wrap gap-2 text-sm">
            <Link href={href({ tag: undefined })} className={`pill ${tag ? "pill-neutral" : "pill-info"}`} aria-current={tag ? undefined : "page"}>All tags</Link>
            {tags.map((t) => (
              <Link key={t.tag} href={href({ tag: t.tag })} className={`pill ${tag === t.tag ? "pill-info" : "pill-neutral"}`} aria-current={tag === t.tag ? "page" : undefined}>
                {t.tag} <span className="hint num">{t.count}</span>
              </Link>
            ))}
          </nav>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer underline w-fit">Download as a spreadsheet</summary>
          <form method="get" action="/admin/orders/export.csv" className="flex flex-wrap items-end gap-3 mt-3" aria-label="Download orders">
            <div className="field">
              <label className="label" htmlFor="export-from">From</label>
              <input className="input" id="export-from" name="from" type="date" />
            </div>
            <div className="field">
              <label className="label" htmlFor="export-to">To</label>
              <input className="input" id="export-to" name="to" type="date" />
            </div>
            {show && <input type="hidden" name="show" value={show} />}
            {q && <input type="hidden" name="q" value={q} />}
            {tag && <input type="hidden" name="tag" value={tag} />}
            {productId && <input type="hidden" name="product" value={productId} />}
            {country && <input type="hidden" name="country" value={country} />}
            {discountId && <input type="hidden" name="code" value={discountId} />}
            {total && <input type="hidden" name="total" value={total} />}
            {buyer && <input type="hidden" name="buyer" value={buyer} />}
            {placed && <input type="hidden" name="placed" value={placed} />}
            {status && <input type="hidden" name="status" value={status} />}
            {payment && <input type="hidden" name="payment" value={payment} />}
            <button className="btn btn-secondary">Download CSV</button>
            <p className="hint w-full">One row per item, for every order on the list (not just this page){filtered || show ? " with your filters" : ""}. Leave the dates empty for all of them.</p>
          </form>
        </details>
        <details className="text-sm">
          <summary className="cursor-pointer underline w-fit">Add tracking from a spreadsheet</summary>
          <TrackingImportForm />
        </details>
        {can(role, "refunds") && (
          <details className="text-sm">
            <summary className="cursor-pointer underline w-fit">Buyer cancellations</summary>
            <div className="mt-3">
              <BuyerCancelForm value={shop.buyerCancel} hours={BUYER_EDIT_HOURS} />
            </div>
          </details>
        )}
        {heldOnly && (
          <section className="card p-5 flex flex-col gap-3" aria-labelledby="risk-settings">
            <h2 id="risk-settings" className="font-semibold">Risk check</h2>
            <p className="text-sm hint max-w-2xl">Every paid order is checked for signs of a stolen card, like a throwaway email, several declined cards or an address many buyers ship to. A held order waits for you before it goes to the supplier, so you can refund it before you&apos;ve paid for the goods.</p>
            <RiskHoldForm value={shop.holdRiskyOrders} options={Object.entries(RISK_HOLD_LABELS)} />
          </section>
        )}
        {transfersOnly && (
          <section className="card p-5 flex flex-col gap-3" aria-labelledby="transfer-settings">
            <h2 id="transfer-settings" className="font-semibold">Bank transfers</h2>
            <p className="text-sm hint max-w-2xl">Let buyers pay by bank transfer instead of by card. They&apos;re emailed your account details with the order number as the reference. Nothing goes to the supplier until you see the money arrive and press Mark as paid on the order. If it doesn&apos;t arrive in time, the order stops waiting and the buyer can still pay by card.</p>
            {shop.plan === "free"
              ? <p className="text-sm">Bank transfers are on paid plans, because on the free plan our 2% comes out of card payments. <Link href="/admin/plan" className="underline">See plans</Link></p>
              : can(role, "money") ? <BankTransferForm value={shop.bankTransfer} max={BANK_DETAILS_MAX} days={TRANSFER_DAYS} /> : <p className="text-sm hint">{shop.bankTransfer ? "Buyers can pay by bank transfer." : "Bank transfers are off."} The store owner can change this.</p>}
          </section>
        )}
        {bulk && <BulkResult value={bulk} />}
        {before && orders.length === 0 ? (
          <div className="card p-10 text-center hint">No older orders. <Link href={href({ before: undefined })} className="underline">Back to the newest</Link></div>
        ) : filtered && orders.length === 0 ? (
          <div className="card p-10 text-center hint">{q ? `No orders match "${q}".` : tag ? `No orders are tagged "${tag}".` : "No orders match these filters."}</div>
        ) : transfersOnly && orders.length === 0 ? (
          <div className="card p-10 text-center hint">No orders are waiting for a bank transfer.</div>
        ) : heldOnly && orders.length === 0 ? (
          <div className="card p-10 text-center hint">No orders on hold.</div>
        ) : problemsOnly && orders.length === 0 ? (
          <div className="card p-10 text-center hint">No problem orders. Anything a supplier refuses or doesn't ship on time shows up here.</div>
        ) : orders.length === 0 ? (
          <div className="card p-10 flex flex-col items-center text-center gap-3">
            <h2 className="font-semibold text-lg">No orders yet</h2>
            <p className="hint max-w-sm">When a buyer checks out, the order shows up here with its payment and delivery status.</p>
            <a href={`/s/${shop.handle}`} target="_blank" className="btn btn-secondary">Visit your store ↗</a>
          </div>
        ) : (
          <>
          <form id="bulk" action={bulkOrdersAction} className="flex flex-wrap items-end gap-2 text-sm" aria-label="Picked orders">
            {show && <input type="hidden" name="keep-show" value={show} />}
            {q && <input type="hidden" name="keep-q" value={q} />}
            {tag && <input type="hidden" name="keep-tag" value={tag} />}
            {productId && <input type="hidden" name="keep-product" value={productId} />}
            {country && <input type="hidden" name="keep-country" value={country} />}
            {discountId && <input type="hidden" name="keep-code" value={discountId} />}
            {total && <input type="hidden" name="keep-total" value={total} />}
            {buyer && <input type="hidden" name="keep-buyer" value={buyer} />}
            {before && <input type="hidden" name="keep-before" value={before} />}
            <div className="field">
              <label className="label" htmlFor="bulk-tag">Tag for the picked orders</label>
              <input className="input" id="bulk-tag" name="bulkTag" list="bulk-tags" placeholder="e.g. rush" />
              <datalist id="bulk-tags">{tags.map((t) => <option key={t.tag} value={t.tag} />)}</datalist>
            </div>
            <button className="btn btn-secondary" name="op" value="add">Add tag</button>
            <button className="btn btn-secondary" name="op" value="remove">Remove tag</button>
            <button className="btn btn-secondary" name="op" value="slips">Packing slips</button>
            <p className="hint w-full">Tick orders below, then tag them or print their packing slips together.</p>
          </form>
          <div className="card overflow-x-auto">
            <table className="table min-w-[680px]">
              <thead><tr><th className="w-8"><SelectAll form="bulk" /></th><th>Order</th><th>Date</th><th>Customer</th><th>Payment</th><th>Delivery</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-sunken">
                    <td><input type="checkbox" name="ids" value={o.id} form="bulk" aria-label={`Pick order #${o.number}`} /></td>
                    <td><Link href={`/admin/orders/${o.id}`} className="font-semibold num">#{o.number}</Link></td>
                    <td className="hint num">{dateFmt.format(o.createdAt)}</td>
                    <td className="max-w-[240px]">
                      <span className="block truncate">{o.shippingAddress.name}</span>
                      {(o.tags.length > 0 || o.buyerNote) && (
                        <span className="flex flex-wrap gap-1 mt-1">
                          {o.buyerNote && <span className="pill pill-info text-xs" title={o.buyerNote}>Has a note</span>}
                          {o.tags.map((t) => <span key={t} className="pill pill-neutral text-xs">{t}</span>)}
                        </span>
                      )}
                    </td>
                    <td><PaymentStatus value={o.paymentStatus} /></td>
                    <td>{onHold(o) ? <span className="pill pill-warning">On hold</span> : <FulfilmentStatus value={o.fulfillmentStatus} />}</td>
                    <td className="text-right num">{formatMoney(o.totalMinor, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(before || older) && (
            <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
              {before && <Link href={href({ before: undefined })} className="btn btn-secondary">← Newest orders</Link>}
              <span className="hint num">#{orders[0]!.number} to #{orders.at(-1)!.number}</span>
              {older && <Link href={href({ before: String(older) })} className="btn btn-secondary ml-auto">Older orders →</Link>}
            </nav>
          )}
          </>
        )}
      </div>
    </main>
  );
}

/** What the bulk bar just did, from the redirect back. */
function BulkResult({ value }: { value: string }) {
  if (value === "none") return <p role="status" className="banner banner-warning">Pick at least one order.</p>;
  const [kind, ...rest] = value.split(":");
  if (kind === "error") return <p role="status" className="banner banner-warning">{rest.join(":")}</p>;
  const [count, fullCount, ...tagParts] = rest;
  const n = Number(count);
  const full = Number(fullCount);
  const tag = tagParts.join(":");
  const orders = n === 1 ? "1 order" : `${n} orders`;
  const noRoom = full ? ` ${full === 1 ? "1 order already has" : `${full} orders already have`} 10 tags, so ${full === 1 ? "it was" : "they were"} left as ${full === 1 ? "it was" : "they were"}.` : "";
  if (kind === "tagged") return <p role="status" className={`banner ${n ? "banner-success" : "banner-warning"}`}>{n ? `Tagged ${orders} “${tag}”.` : full ? "" : `Those orders were already tagged “${tag}”.`}{noRoom}</p>;
  if (kind === "untagged") return <p role="status" className="banner banner-success">{n ? `Took “${tag}” off ${orders}.` : `None of those orders were tagged “${tag}”.`}</p>;
  return null;
}
