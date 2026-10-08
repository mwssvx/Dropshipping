import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, schema, type Db } from "@sf/db";
import {
  applyAccountStatus,
  changePlan,
  createShop,
  DEMO_SUPPLIER_LINKS,
  estimateProcessingFee,
  FakePaymentProvider,
  FakeSupplier,
  handlePaymentEvent,
  importProduct,
  listRequirements,
  LogMailer,
  moneySummary,
  planAdvice,
  platformFeeFor,
  refreshPayoutAccount,
  refundOrder,
  requirementKind,
  routeOrder,
  runFakePayouts,
  signUp,
  simulateHold,
  startCheckout,
  startPayoutSetup,
  statementCsv,
  submitRequirementDocument,
  suppliersFrom,
  UserError,
  type PaymentEvent,
  type RefundContext,
} from "../src";

const address = { name: "Ada Buyer", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const LAMP = DEMO_SUPPLIER_LINKS[0]!;
const DAY = 86_400_000;

let db: Db;
let clock: number;
let mailer: LogMailer;
let payments: FakePaymentProvider;
let ctx: RefundContext;

beforeEach(async () => {
  db = await createTestDb();
  clock = Date.now();
  mailer = new LogMailer(true);
  payments = new FakePaymentProvider();
  ctx = {
    db,
    payments,
    suppliers: suppliersFrom([new FakeSupplier({ shipAfterMs: DAY, deliverAfterMs: 5 * DAY, now: () => clock })]),
    mailer,
    orderStatusUrl: (shop, order) => `https://${shop.handle}.example/orders/${order.paymentIntentId}`,
    now: () => new Date(clock),
  };
});

async function shop() {
  const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
  return createShop(db, user.id, { name: "Glow Lamps", country: "US" });
}

async function freshShop(id: string) {
  return (await db.query.shops.findFirst({ where: eq(schema.shops.id, id) }))!;
}

async function send(event: PaymentEvent) {
  const { body, signature } = payments.event(event);
  return handlePaymentEvent(db, "fake", (await payments.parseWebhook(body, signature))!);
}

async function paidOrder(s: Awaited<ReturnType<typeof shop>>, quantity = 2) {
  const existing = await db.query.products.findFirst({ where: eq(schema.products.shopId, s.id) });
  const product = existing ?? (await importProduct(db, ctx.suppliers, s.id, { url: LAMP, title: "Lamp", prices: {}, publish: true }));
  const variant = (await db.query.variants.findFirst({ where: eq(schema.variants.productId, product.id) }))!;
  const { order } = await startCheckout(db, payments, await freshShop(s.id), { email: "ada@example.com", address, lines: [{ variantId: variant.id, quantity }] });
  await send({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
  return (await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
}

describe("plans and fees", () => {
  it("takes 2% on the free plan and nothing on paid plans", async () => {
    expect(platformFeeFor("free", 10_000)).toBe(200);
    expect(platformFeeFor("free", 2_525)).toBe(51);
    expect(platformFeeFor("growth", 10_000)).toBe(0);
    expect(estimateProcessingFee(10_000)).toBe(320);

    const s = await shop();
    expect(s.plan).toBe("free");
    const order = await paidOrder(s);
    expect(order.platformFeeMinor).toBe(platformFeeFor("free", order.totalMinor));
    expect(order.processingFeeMinor).toBe(estimateProcessingFee(order.totalMinor));

    // Test mode has no checkout page, so the change applies at once.
    expect(await changePlan(db, payments, s, { plan: "growth", email: "owner@example.com", returnUrl: "http://x/plan" })).toEqual({ url: null, plan: "growth" });
    expect((await paidOrder(s)).platformFeeMinor).toBe(0);
    await expect(changePlan(db, payments, s, { plan: "platinum", email: "o@example.com", returnUrl: "http://x" })).rejects.toThrow(UserError);
  });

  it("tells a busy free store when a paid plan would cost less", async () => {
    const s = await shop();
    await paidOrder(s, 1);
    expect((await planAdvice(db, s)).best).toBeNull();

    // A big month: about $3,000 in sales means $60 in fees, more than Growth's $49.
    await db.update(schema.orders).set({ totalMinor: 300_000, subtotalMinor: 300_000, shippingMinor: 0, platformFeeMinor: 6_000 }).where(eq(schema.orders.shopId, s.id));
    const advice = await planAdvice(db, s);
    expect(advice.best).toEqual({ plan: "starter", saveMinor: 6_000 - 1_900 });
  });

  it("follows plan changes from billing webhooks", async () => {
    const s = await shop();
    await send({ id: "evt_plan_1", type: "plan.updated", shopId: s.id, plan: "scale", customerId: "cus_1", subscriptionId: "sub_1" });
    expect(await freshShop(s.id)).toMatchObject({ plan: "scale", billingCustomerId: "cus_1", billingSubscriptionId: "sub_1" });
    // Cancelled subscription: back to free, customer kept for next time.
    await send({ id: "evt_plan_2", type: "plan.updated", shopId: s.id, plan: null, customerId: "cus_1", subscriptionId: null });
    expect(await freshShop(s.id)).toMatchObject({ plan: "free", billingCustomerId: "cus_1", billingSubscriptionId: null });
  });
});

describe("refunds", () => {
  it("refunds in parts, returns our fee in proportion, and emails the buyer each time", async () => {
    const s = await shop();
    const order = await paidOrder(s);
    const fee = order.platformFeeMinor;
    expect(fee).toBeGreaterThan(0);

    const half = Math.floor(order.totalMinor / 2);
    const first = await refundOrder(ctx, s.id, order.id, { amountMinor: half, reason: "Arrived scratched" });
    expect(first.full).toBe(false);
    expect(first.refund.platformFeeRefundedMinor).toBe(Math.round((fee * half) / order.totalMinor));
    await expect(refundOrder(ctx, s.id, order.id, { amountMinor: order.totalMinor })).rejects.toThrow(/at most/);

    const rest = await refundOrder(ctx, s.id, order.id, {});
    expect(rest.full).toBe(true);
    expect(first.refund.platformFeeRefundedMinor + rest.refund.platformFeeRefundedMinor).toBe(fee);
    expect(await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) })).toMatchObject({
      paymentStatus: "refunded",
      refundedMinor: order.totalMinor,
    });
    const refundMails = mailer.sent.filter((m) => m.subject.startsWith("Refund for order"));
    expect(refundMails).toHaveLength(2);
    expect(refundMails[0]!.text).toContain("Arrived scratched");
    await expect(refundOrder(ctx, s.id, order.id, {})).rejects.toThrow(/Only paid orders/);
  });

  it("cancels the supplier order on a full refund if it hasn't shipped", async () => {
    const s = await shop();
    const order = await paidOrder(s);
    await routeOrder(ctx, order.id);
    const result = await refundOrder(ctx, s.id, order.id, {});
    expect(result).toMatchObject({ cancelled: 1, notCancelled: [] });
    const [f] = await db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id) });
    expect(f!.status).toBe("cancelled");
  });

  it("says so when the parcel already shipped", async () => {
    const s = await shop();
    const order = await paidOrder(s);
    await routeOrder(ctx, order.id);
    clock += 2 * DAY; // the demo supplier ships after a day
    const result = await refundOrder(ctx, s.id, order.id, {});
    expect(result.cancelled).toBe(0);
    expect(result.notCancelled[0]!.message).toMatch(/already shipped/);
  });
});

describe("payouts", () => {
  it("sets up a payout account and turns payouts on", async () => {
    const s = await shop();
    const url = await startPayoutSetup(db, payments, s, { email: "owner@example.com", returnUrl: "http://x/money?setup=done", refreshUrl: "http://x/money" });
    expect(url).toBe("http://x/money?setup=done");
    const withAccount = await freshShop(s.id);
    expect(withAccount.paymentsAccountId).toMatch(/^fake_acct_/);
    // A second press reuses the same account.
    await startPayoutSetup(db, payments, withAccount, { email: "owner@example.com", returnUrl: "http://x", refreshUrl: "http://x" });
    expect((await freshShop(s.id)).paymentsAccountId).toBe(withAccount.paymentsAccountId);

    await refreshPayoutAccount(db, payments, withAccount);
    expect(await freshShop(s.id)).toMatchObject({ chargesEnabled: true, payoutsEnabled: true });
  });

  it("shows a hold with the reason, takes the document, and releases payouts", async () => {
    const s = await shop();
    await startPayoutSetup(db, payments, s, { email: "o@example.com", returnUrl: "http://x", refreshUrl: "http://x" });
    await simulateHold(db, s.id, "identity_document");
    expect((await freshShop(s.id)).payoutsEnabled).toBe(false);
    const [req] = await listRequirements(db, s.id);
    expect(req).toMatchObject({ kind: "identity_document", title: "Photo ID", upload: true, holdsPayouts: true });
    expect(req!.dueBy).toBeInstanceOf(Date);

    const shopRow = await freshShop(s.id);
    await expect(submitRequirementDocument(db, payments, shopRow, req!.id, { name: "id.exe", type: "application/x-msdownload", data: Buffer.from("MZ") })).rejects.toThrow(/JPG, PNG or PDF/);
    await expect(
      submitRequirementDocument(db, payments, shopRow, req!.id, { name: "big.png", type: "image/png", data: Buffer.alloc(6 * 1024 * 1024) }),
    ).rejects.toThrow(/over 5 MB/);
    await submitRequirementDocument(db, payments, shopRow, req!.id, { name: "passport.png", type: "image/png", data: Buffer.from("png") });
    expect(await listRequirements(db, s.id)).toHaveLength(0);
    expect((await freshShop(s.id)).payoutsEnabled).toBe(true);
    expect(await db.query.requirementUploads.findMany()).toHaveLength(1);
  });

  it("turns the processor's requests into plain cards and clears the ones it drops", async () => {
    expect(requirementKind("individual.verification.document")).toBe("identity_document");
    expect(requirementKind("person_abc.verification.additional_document")).toBe("proof_of_address");
    expect(requirementKind("external_account")).toBe("bank_account");
    expect(requirementKind("business_profile.url")).toBe("business_details");

    const s = await shop();
    await db.update(schema.shops).set({ paymentsAccountId: "acct_1" }).where(eq(schema.shops.id, s.id));
    const due = new Date(Date.now() + 5 * DAY);
    await send({
      id: "evt_acct_1",
      type: "account.updated",
      accountId: "acct_1",
      status: {
        chargesEnabled: true,
        payoutsEnabled: false,
        disabledReason: null,
        requirements: [
          { key: "individual.verification.document", dueBy: due, holdsPayouts: true },
          { key: "external_account", dueBy: due, holdsPayouts: true },
        ],
      },
    });
    expect((await listRequirements(db, s.id)).map((r) => r.kind).sort()).toEqual(["bank_account", "identity_document"]);

    // The bank account was added; the ID is still needed.
    await applyAccountStatus(db, s.id, {
      chargesEnabled: true,
      payoutsEnabled: false,
      disabledReason: null,
      requirements: [{ key: "individual.verification.document", dueBy: due, holdsPayouts: true }],
    });
    expect((await listRequirements(db, s.id)).map((r) => r.kind)).toEqual(["identity_document"]);

    // Paused for review with nothing to send: one "review" card.
    await applyAccountStatus(db, s.id, { chargesEnabled: true, payoutsEnabled: false, disabledReason: "under_review", requirements: [] });
    expect((await listRequirements(db, s.id)).map((r) => r.kind)).toEqual(["review"]);

    expect((await send({ id: "evt_acct_x", type: "account.updated", accountId: "acct_unknown", status: { chargesEnabled: true, payoutsEnabled: true, disabledReason: null, requirements: [] } })).status).toBe("unknown_account");
  });

  it("works out the balance, pays it out, and lists it all in the statement", async () => {
    const s = await shop();
    await startPayoutSetup(db, payments, s, { email: "o@example.com", returnUrl: "http://x", refreshUrl: "http://x" });
    await refreshPayoutAccount(db, payments, await freshShop(s.id));
    const order = await paidOrder(s);
    const net = order.totalMinor - order.platformFeeMinor - order.processingFeeMinor;

    const now = new Date();
    let money = await moneySummary(db, await freshShop(s.id), now);
    expect(money).toMatchObject({ availableMinor: 0, pendingMinor: net, onTheWayMinor: 0 });
    expect(money.last30.profitMinor).toBe(order.subtotalMinor - order.platformFeeMinor - order.processingFeeMinor - money.last30.supplierCostsMinor);

    // Two days later the money has cleared and goes out.
    const later = new Date(now.getTime() + 3 * DAY);
    money = await moneySummary(db, await freshShop(s.id), later);
    expect(money).toMatchObject({ availableMinor: net, pendingMinor: 0 });
    expect(await runFakePayouts(db, later)).toEqual({ sent: 1, arrived: 0 });
    money = await moneySummary(db, await freshShop(s.id), later);
    expect(money).toMatchObject({ availableMinor: 0, onTheWayMinor: net });
    expect(await runFakePayouts(db, new Date(later.getTime() + 3 * DAY))).toEqual({ sent: 0, arrived: 1 });
    expect((await moneySummary(db, await freshShop(s.id), later)).paidOutMinor).toBe(net);

    // A refund after the payout leaves a negative balance, as with any processor.
    await refundOrder(ctx, s.id, order.id, { amountMinor: 1000, reason: 'Said "broken", =SUM(A1)' });
    const csv = await statementCsv(db, await freshShop(s.id), { from: new Date(now.getTime() - DAY), to: new Date(later.getTime() + 10 * DAY) });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("date,type,reference,amount (USD),of which tax,our fee,card fee (est.),net,note");
    expect(lines.slice(1).map((l) => l.split(",")[1])).toEqual(["sale", "refund", "payout (paid)"]);
    expect(csv).toContain(`#${order.number}`);
    expect(csv).toContain('"Said ""broken"", =SUM(A1)"');
  });

  it("records payouts the processor reports", async () => {
    const s = await shop();
    await db.update(schema.shops).set({ paymentsAccountId: "acct_9" }).where(eq(schema.shops.id, s.id));
    const payout = { id: "po_1", amountMinor: 4200, currency: "USD", status: "in_transit" as const, arrivalDate: "2026-10-12", failureReason: null };
    await send({ id: "evt_po_1", type: "payout.updated", accountId: "acct_9", payout });
    await send({ id: "evt_po_2", type: "payout.updated", accountId: "acct_9", payout: { ...payout, status: "paid" } });
    const rows = await db.query.payouts.findMany({ where: eq(schema.payouts.shopId, s.id) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "paid", amountMinor: 4200, arrivalDate: "2026-10-12" });
  });
});
