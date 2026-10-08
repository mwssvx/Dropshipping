import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import type { PaymentEvent, PaymentProvider, PayoutAccountStatus, ProviderPayout, ProviderRequirement } from "./payments";
import { PLAN_IDS, PLANS, type PlanId } from "./plans";

type Shop = typeof schema.shops.$inferSelect;
type Requirement = typeof schema.accountRequirements.$inferSelect;
export type RequirementKind = Requirement["kind"];

const DAY = 86_400_000;

/*
 * Getting paid. Card payments land in the merchant's own payout account (Stripe Connect Express);
 * we mirror its status, payouts and anything it asks for, and explain each request in plain words.
 * Nothing on this page is a black box: every hold says why, what to send and by when.
 */

/** What each kind of request means, in the words the merchant sees, and whether they can upload for it. */
export const REQUIREMENT_KINDS: Record<RequirementKind, { title: string; explanation: string; upload: boolean }> = {
  identity_document: {
    title: "Photo ID",
    explanation:
      "Card networks require every seller to prove who they are before money is paid out. Send a clear photo of your passport, driving licence or national ID card.",
    upload: true,
  },
  proof_of_address: {
    title: "Proof of address",
    explanation:
      "The address you gave couldn't be matched to your ID. Send a utility bill, bank statement or tax letter from the last 6 months showing your name and address.",
    upload: true,
  },
  bank_account: {
    title: "Bank account",
    explanation: "We need a bank account to send your money to. Add one, or fix the one that was rejected.",
    upload: false,
  },
  business_details: {
    title: "Missing details",
    explanation: "Some details about you or your business are missing or couldn't be checked. Finish them on the secure form.",
    upload: false,
  },
  supplier_invoice: {
    title: "Supplier invoice",
    explanation:
      "Sales jumped quickly, so the payment processor wants to see that you can deliver. Send an invoice or order confirmation from your supplier for recent orders.",
    upload: true,
  },
  tracking_info: {
    title: "Proof of delivery",
    explanation:
      "Some buyers disputed payments. Send tracking numbers or delivery confirmations for recent orders so the processor can see they shipped.",
    upload: true,
  },
  review: {
    title: "Account review",
    explanation: "The payment processor is reviewing this account. There's nothing to send right now; payouts resume when the review ends.",
    upload: false,
  },
};

/** Map a provider's request key (Stripe's requirement names, or our test ones) to a kind. */
export function requirementKind(key: string): RequirementKind {
  if (key.startsWith("sim.")) {
    const kind = key.slice(4) as RequirementKind;
    if (kind in REQUIREMENT_KINDS) return kind;
  }
  if (key.endsWith("verification.additional_document")) return "proof_of_address";
  if (key.endsWith("verification.document")) return "identity_document";
  if (key === "external_account" || key.startsWith("external_account.")) return "bank_account";
  if (key === "review") return "review";
  return "business_details";
}

/**
 * Mirror the payout account's state onto the shop: charges and payouts flags, and one open
 * request card per thing the provider still needs. Requests that disappeared are marked resolved.
 */
export async function applyAccountStatus(db: Db, shopId: string, status: PayoutAccountStatus, at = new Date()) {
  // Dates arrive as strings when the status came through a JSON webhook body.
  const wanted: ProviderRequirement[] = status.requirements.map((r) => ({ ...r, dueBy: r.dueBy ? new Date(r.dueBy) : null }));
  if (status.disabledReason && !wanted.length) wanted.push({ key: "review", dueBy: null, holdsPayouts: true });
  await db
    .update(schema.shops)
    .set({ chargesEnabled: status.chargesEnabled, payoutsEnabled: status.payoutsEnabled, updatedAt: at })
    .where(eq(schema.shops.id, shopId));

  const open = await db.query.accountRequirements.findMany({
    where: and(eq(schema.accountRequirements.shopId, shopId), isNull(schema.accountRequirements.resolvedAt)),
  });
  const keys = new Set(wanted.map((r) => r.key));
  const gone = open.filter((r) => !keys.has(r.providerKey)).map((r) => r.id);
  if (gone.length) {
    await db.update(schema.accountRequirements).set({ resolvedAt: at }).where(inArray(schema.accountRequirements.id, gone));
  }
  for (const r of wanted) {
    const existing = open.find((o) => o.providerKey === r.key);
    if (existing) {
      await db
        .update(schema.accountRequirements)
        .set({ dueBy: r.dueBy, holdsPayouts: r.holdsPayouts })
        .where(eq(schema.accountRequirements.id, existing.id));
      continue;
    }
    const kind = requirementKind(r.key);
    await db
      .insert(schema.accountRequirements)
      .values({ shopId, providerKey: r.key, kind, explanation: REQUIREMENT_KINDS[kind].explanation, holdsPayouts: r.holdsPayouts, dueBy: r.dueBy })
      .onConflictDoNothing();
  }
}

/** Apply a payout-account, payout or plan webhook. Returns false when it isn't for any of our shops. */
export async function applyMoneyEvent(db: Db, event: Exclude<PaymentEvent, { type: "payment.succeeded" | "payment.failed" }>) {
  if (event.type === "plan.updated") {
    const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, event.shopId) });
    if (!shop) return false;
    const plan = event.plan && PLAN_IDS.includes(event.plan as PlanId) ? (event.plan as PlanId) : "free";
    await db
      .update(schema.shops)
      .set({ plan, billingCustomerId: event.customerId, billingSubscriptionId: event.subscriptionId, updatedAt: new Date() })
      .where(eq(schema.shops.id, shop.id));
    return true;
  }
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.paymentsAccountId, event.accountId) });
  if (!shop) return false;
  if (event.type === "account.updated") await applyAccountStatus(db, shop.id, event.status);
  else await upsertPayout(db, shop.id, event.payout);
  return true;
}

async function upsertPayout(db: Db, shopId: string, p: ProviderPayout) {
  const values = {
    amountMinor: p.amountMinor,
    currency: p.currency,
    status: p.status,
    arrivalDate: p.arrivalDate,
    failureReason: p.failureReason,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.payouts)
    .values({ shopId, providerPayoutId: p.id, ...values })
    .onConflictDoUpdate({ target: schema.payouts.providerPayoutId, set: values });
}

// Setup ----------------------------------------------------------------------------------------

/** Create the payout account if needed and return where the merchant fills in bank and ID details. */
export async function startPayoutSetup(
  db: Db,
  payments: PaymentProvider,
  shop: Shop,
  input: { email: string; returnUrl: string; refreshUrl: string },
) {
  let accountId = shop.paymentsAccountId;
  if (!accountId) {
    ({ accountId } = await payments.createPayoutAccount({ shopId: shop.id, country: shop.country, email: input.email }));
    // Only the first request's account sticks if two run at once.
    const [saved] = await db
      .update(schema.shops)
      .set({ paymentsAccountId: accountId, updatedAt: new Date() })
      .where(and(eq(schema.shops.id, shop.id), isNull(schema.shops.paymentsAccountId)))
      .returning({ accountId: schema.shops.paymentsAccountId });
    if (!saved) accountId = (await db.query.shops.findFirst({ where: eq(schema.shops.id, shop.id) }))!.paymentsAccountId!;
  }
  return payments.payoutOnboardingUrl({ accountId, returnUrl: input.returnUrl, refreshUrl: input.refreshUrl });
}

/** Re-read the payout account from the provider (on return from setup, or after sending a document). */
export async function refreshPayoutAccount(db: Db, payments: PaymentProvider, shop: Shop) {
  if (!shop.paymentsAccountId) return null;
  const status = await payments.getPayoutAccount(shop.paymentsAccountId);
  await applyAccountStatus(db, shop.id, status);
  return status;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const UPLOAD_TYPES = ["image/jpeg", "image/png", "application/pdf"];

/** Send a document for one request card. Stored with us, then forwarded to the provider. */
export async function submitRequirementDocument(
  db: Db,
  payments: PaymentProvider,
  shop: Shop,
  requirementId: string,
  file: { name: string; type: string; data: Buffer },
) {
  const req = await db.query.accountRequirements.findFirst({
    where: and(eq(schema.accountRequirements.id, requirementId), eq(schema.accountRequirements.shopId, shop.id)),
  });
  if (!req || req.resolvedAt) throw new NotFoundError("Request");
  if (!REQUIREMENT_KINDS[req.kind].upload) throw new UserError("This one isn't a document. Use Update details instead.");
  if (!file.data.length) throw new UserError("Choose a file to send.");
  if (file.data.length > MAX_UPLOAD_BYTES) throw new UserError("That file is over 5 MB. Send a smaller photo or PDF.");
  if (!UPLOAD_TYPES.includes(file.type)) throw new UserError("Send a JPG, PNG or PDF.");
  if (!shop.paymentsAccountId) throw new UserError("Set up payouts first.");

  const { fileId } = await payments.submitDocument({
    accountId: shop.paymentsAccountId,
    requirementKey: req.providerKey,
    fileName: file.name,
    contentType: file.type,
    data: file.data,
  });
  await db.insert(schema.requirementUploads).values({
    requirementId: req.id,
    fileName: file.name.slice(0, 200),
    contentType: file.type,
    sizeBytes: file.data.length,
    data: file.data,
    providerFileId: fileId,
  });
  await db.update(schema.accountRequirements).set({ submittedAt: new Date() }).where(eq(schema.accountRequirements.id, req.id));
  // Test requests are ours to clear; real ones clear when the provider's next update drops them.
  if (req.providerKey.startsWith("sim.")) {
    await db.update(schema.accountRequirements).set({ resolvedAt: new Date() }).where(eq(schema.accountRequirements.id, req.id));
    await reopenPayoutsIfClear(db, shop.id);
  } else {
    await refreshPayoutAccount(db, payments, shop);
  }
  return { fileId };
}

async function reopenPayoutsIfClear(db: Db, shopId: string) {
  const holding = await db.query.accountRequirements.findFirst({
    where: and(
      eq(schema.accountRequirements.shopId, shopId),
      isNull(schema.accountRequirements.resolvedAt),
      eq(schema.accountRequirements.holdsPayouts, true),
    ),
  });
  if (!holding) await db.update(schema.shops).set({ payoutsEnabled: true, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}

/**
 * Test mode only: pretend the payment processor paused payouts and asked for something, so the
 * hold card, upload and release can be tried without a real account.
 */
export async function simulateHold(db: Db, shopId: string, kind: RequirementKind = "identity_document", at = new Date()) {
  await db
    .insert(schema.accountRequirements)
    .values({
      shopId,
      providerKey: `sim.${kind}`,
      kind,
      explanation: REQUIREMENT_KINDS[kind].explanation,
      holdsPayouts: true,
      dueBy: new Date(at.getTime() + 7 * DAY),
    })
    .onConflictDoNothing();
  await db.update(schema.shops).set({ payoutsEnabled: false, updatedAt: at }).where(eq(schema.shops.id, shopId));
}

export async function listRequirements(db: Db, shopId: string) {
  const rows = await db.query.accountRequirements.findMany({
    where: and(eq(schema.accountRequirements.shopId, shopId), isNull(schema.accountRequirements.resolvedAt)),
    orderBy: desc(schema.accountRequirements.createdAt),
  });
  return rows.map((r) => ({ ...REQUIREMENT_KINDS[r.kind], ...r }));
}

// Balance -------------------------------------------------------------------------------------

/**
 * The merchant's money from our own records: what buyers paid, minus refunds, our sales fee and
 * the card processing fee, minus what has already been paid out. Supplier costs are shown so the
 * merchant sees profit, but they're paid to the supplier separately, not taken from payouts.
 */
export async function moneySummary(db: Db, shop: Shop, now = new Date()) {
  const o = schema.orders;
  const settled = inArray(o.paymentStatus, ["paid", "partially_refunded", "refunded"]);
  const earned = sql<number>`coalesce(sum(${o.totalMinor} - ${o.refundedMinor} - ${o.platformFeeMinor} - ${o.processingFeeMinor}), 0)::bigint`;
  // Stripe's standard payout schedule makes card money available about two days after payment.
  const clearsAt = new Date(now.getTime() - 2 * DAY);
  const [all] = await db.select({ earned }).from(o).where(and(eq(o.shopId, shop.id), settled));
  const [clearing] = await db.select({ earned }).from(o).where(and(eq(o.shopId, shop.id), settled, gte(o.paidAt, clearsAt)));
  const feeRefunds = await db
    .select({ sum: sql<number>`coalesce(sum(${schema.refunds.platformFeeRefundedMinor}), 0)::bigint` })
    .from(schema.refunds)
    .where(eq(schema.refunds.shopId, shop.id));

  const p = schema.payouts;
  const payoutSum = (statuses: (typeof p.$inferSelect)["status"][]) =>
    db
      .select({ sum: sql<number>`coalesce(sum(${p.amountMinor}), 0)::bigint` })
      .from(p)
      .where(and(eq(p.shopId, shop.id), inArray(p.status, statuses)));
  const [[paid], [onTheWay]] = await Promise.all([payoutSum(["paid"]), payoutSum(["pending", "in_transit"])]);

  const since = new Date(now.getTime() - 30 * DAY);
  const [month] = await db
    .select({
      orders: sql<number>`count(*)::int`,
      sales: sql<number>`coalesce(sum(${o.totalMinor} - ${o.refundedMinor}), 0)::bigint`,
      platformFees: sql<number>`coalesce(sum(${o.platformFeeMinor}), 0)::bigint`,
      processingFees: sql<number>`coalesce(sum(${o.processingFeeMinor}), 0)::bigint`,
      refunds: sql<number>`coalesce(sum(${o.refundedMinor}), 0)::bigint`,
      shipping: sql<number>`coalesce(sum(${o.shippingMinor}) filter (where ${o.paymentStatus} <> 'refunded'), 0)::bigint`,
    })
    .from(o)
    .where(and(eq(o.shopId, shop.id), settled, gte(o.paidAt, since)));
  const [costs] = await db
    .select({ sum: sql<number>`coalesce(sum(${schema.orderLines.unitCostMinor} * ${schema.orderLines.quantity}), 0)::bigint` })
    .from(schema.orderLines)
    .innerJoin(o, eq(o.id, schema.orderLines.orderId))
    .where(and(eq(o.shopId, shop.id), inArray(o.paymentStatus, ["paid", "partially_refunded"]), gte(o.paidAt, since)));

  const n = (v: unknown) => Number(v ?? 0);
  const total = n(all?.earned) + n(feeRefunds[0]?.sum) - n(paid?.sum) - n(onTheWay?.sum);
  const pending = Math.min(Math.max(n(clearing?.earned), 0), Math.max(total, 0));
  const platformFees = n(month?.platformFees);
  return {
    currency: shop.currency,
    /** Ready for the next payout. */
    availableMinor: total - pending,
    /** Paid in the last two days; becomes available after that. */
    pendingMinor: pending,
    onTheWayMinor: n(onTheWay?.sum),
    paidOutMinor: n(paid?.sum),
    last30: {
      orders: n(month?.orders),
      salesMinor: n(month?.sales),
      refundsMinor: n(month?.refunds),
      platformFeesMinor: platformFees,
      processingFeesMinor: n(month?.processingFees),
      supplierCostsMinor: n(costs?.sum),
      // The shipping charge is assumed to cover the supplier's shipping, so it isn't counted as profit.
      shippingMinor: n(month?.shipping),
      profitMinor: n(month?.sales) - n(month?.shipping) - platformFees - n(month?.processingFees) - n(costs?.sum),
    },
  };
}

export async function listPayouts(db: Db, shopId: string, limit = 20) {
  return db.query.payouts.findMany({ where: eq(schema.payouts.shopId, shopId), orderBy: desc(schema.payouts.createdAt), limit });
}

/**
 * Test mode stand-in for the processor's payout schedule: pays out each store's available
 * balance, and marks payouts paid once their arrival date passes. Stores on hold are skipped.
 */
export async function runFakePayouts(db: Db, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const arrived = await db
    .update(schema.payouts)
    .set({ status: "paid", updatedAt: now })
    .where(and(inArray(schema.payouts.status, ["pending", "in_transit"]), lte(schema.payouts.arrivalDate, today), sql`${schema.payouts.providerPayoutId} like 'fake_po_%'`))
    .returning({ id: schema.payouts.id });
  const shops = await db.query.shops.findMany({ where: and(eq(schema.shops.payoutsEnabled, true), sql`${schema.shops.paymentsAccountId} like 'fake_acct_%'`) });
  let sent = 0;
  for (const shop of shops) {
    const { availableMinor } = await moneySummary(db, shop, now);
    if (availableMinor <= 0) continue;
    await db.insert(schema.payouts).values({
      shopId: shop.id,
      providerPayoutId: `fake_po_${shop.id.slice(0, 8)}_${now.getTime()}`,
      amountMinor: availableMinor,
      currency: shop.currency,
      status: "in_transit",
      arrivalDate: new Date(now.getTime() + 2 * DAY).toISOString().slice(0, 10),
      createdAt: now,
      updatedAt: now,
    });
    sent++;
  }
  return { sent, arrived: arrived.length };
}

// Statement -----------------------------------------------------------------------------------

const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  // Quote anything with separators, and defuse cells a spreadsheet would run as a formula.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Every sale, refund and payout in a date range, one line each, for an accountant. */
export async function statementCsv(db: Db, shop: Shop, range: { from: Date; to: Date }) {
  const money = (minor: number) => (minor / 100).toFixed(2);
  const o = schema.orders;
  const orders = await db.query.orders.findMany({
    where: and(eq(o.shopId, shop.id), inArray(o.paymentStatus, ["paid", "partially_refunded", "refunded"]), gte(o.paidAt, range.from), lte(o.paidAt, range.to)),
    orderBy: o.paidAt,
  });
  const refunds = await db
    .select({ refund: schema.refunds, number: o.number })
    .from(schema.refunds)
    .innerJoin(o, eq(o.id, schema.refunds.orderId))
    .where(and(eq(schema.refunds.shopId, shop.id), gte(schema.refunds.createdAt, range.from), lte(schema.refunds.createdAt, range.to)));
  const payouts = await db.query.payouts.findMany({
    where: and(eq(schema.payouts.shopId, shop.id), gte(schema.payouts.createdAt, range.from), lte(schema.payouts.createdAt, range.to)),
  });

  type Row = { at: Date; cells: (string | number | null)[] };
  const rows: Row[] = [
    ...orders.map((x) => ({
      at: x.paidAt!,
      cells: ["sale", `#${x.number}`, money(x.totalMinor), money(-x.platformFeeMinor), money(-x.processingFeeMinor), money(x.totalMinor - x.platformFeeMinor - x.processingFeeMinor), x.email],
    })),
    ...refunds.map(({ refund: r, number }) => ({
      at: r.createdAt,
      cells: ["refund", `#${number}`, money(-r.amountMinor), money(r.platformFeeRefundedMinor), money(0), money(-r.amountMinor + r.platformFeeRefundedMinor), r.reason],
    })),
    ...payouts.map((p) => ({
      at: p.createdAt,
      cells: [`payout (${p.status.replace("_", " ")})`, p.arrivalDate ? `arrives ${p.arrivalDate}` : "", money(0), money(0), money(0), money(-p.amountMinor), null],
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const header = ["date", "type", "reference", `amount (${shop.currency})`, "our fee", "card fee (est.)", "net", "note"];
  return [header, ...rows.map((r) => [r.at.toISOString().slice(0, 10), ...r.cells])].map((line) => line.map(csvCell).join(",")).join("\n") + "\n";
}

// Plans ---------------------------------------------------------------------------------------

/**
 * Switch plans. With real billing this returns Stripe's checkout or billing page; in test mode
 * (no page to pay on) the change applies at once.
 */
export async function changePlan(
  db: Db,
  payments: PaymentProvider,
  shop: Shop,
  input: { plan: string; email: string; returnUrl: string },
) {
  if (!PLAN_IDS.includes(input.plan as PlanId)) throw new UserError("Choose a plan.");
  const plan = input.plan as PlanId;
  if (plan === shop.plan) return { url: null, plan };
  const url = await payments.planCheckoutUrl({
    shopId: shop.id,
    plan,
    customerId: shop.billingCustomerId,
    subscriptionId: shop.billingSubscriptionId,
    email: input.email,
    returnUrl: input.returnUrl,
  });
  if (url) return { url, plan };
  await db.update(schema.shops).set({ plan, updatedAt: new Date() }).where(eq(schema.shops.id, shop.id));
  return { url: null, plan };
}

export { PLANS };
