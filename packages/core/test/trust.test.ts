import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, schema, type Db } from "@sf/db";
import {
  createPage,
  createShop,
  decideAppeal,
  listNotices,
  listOpenAppeals,
  openNotices,
  refreshVerified,
  runHealthChecks,
  sendNotice,
  signUp,
  startCheckout,
  storeHealth,
  submitAppeal,
  UserError,
  verifiedChecklist,
  createProduct,
  FakePaymentProvider,
} from "../src";

const DAY = 86_400_000;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function shop() {
  const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
  return createShop(db, user.id, { name: "Glow Lamps", country: "US" });
}
const fresh = async (id: string) => (await db.query.shops.findFirst({ where: eq(schema.shops.id, id) }))!;

/** Paid orders with one supplier fulfilment each, shipped after `shipDays` (null: not shipped). */
async function history(shopId: string, rows: { shipDays: number | null; refunded?: boolean }[], now: number) {
  const s = await fresh(shopId);
  const product = await createProduct(db, shopId, {
    title: "Lamp", descriptionHtml: "", imageUrl: "", status: "active",
    variants: [{ title: "Default", priceMinor: 3000, compareAtMinor: null, costMinor: 1000 }],
  });
  const variant = (await db.query.variants.findFirst({ where: eq(schema.variants.productId, product.id) }))!;
  const [supplier] = await db.insert(schema.suppliers).values({ shopId, provider: "fake", status: "connected" }).returning();
  for (const r of rows) {
    const { order } = await startCheckout(db, new FakePaymentProvider(), s, {
      email: "b@example.com",
      address: { name: "B", line1: "1 St", city: "X", region: "TX", postalCode: "78701", country: "US" },
      lines: [{ variantId: variant.id, quantity: 1 }],
    });
    const placedAt = new Date(now - 20 * DAY);
    await db.update(schema.orders).set({
      paymentStatus: r.refunded ? "refunded" : "paid",
      refundedMinor: r.refunded ? order.totalMinor : 0,
      paidAt: placedAt,
      fulfillmentStatus: r.shipDays === null ? "sent_to_supplier" : "shipped",
    }).where(eq(schema.orders.id, order.id));
    await db.insert(schema.fulfillments).values({
      shopId, orderId: order.id, supplierId: supplier!.id,
      status: r.shipDays === null ? "placed" : "shipped",
      placedAt,
      shippedAt: r.shipDays === null ? null : new Date(placedAt.getTime() + r.shipDays * DAY),
      trackingNumber: r.shipDays === null ? null : "T1",
      carrier: r.shipDays === null ? null : "Post",
    });
  }
}

describe("notices and appeals", () => {
  it("warns before it pauses, and every pause can be appealed", async () => {
    const s = await shop();
    const why = "Three buyers said the lamp arrived without a plug.";
    await expect(sendNotice(db, { shopId: s.id, kind: "paused", reason: "customer_complaints", explanation: why, by: "staff@x" })).rejects.toThrow(/warning with a deadline first/);
    await expect(sendNotice(db, { shopId: s.id, kind: "warning", reason: "customer_complaints", explanation: "bad", by: "staff@x" })).rejects.toThrow(UserError);

    const warning = await sendNotice(db, { shopId: s.id, kind: "warning", reason: "customer_complaints", explanation: why, by: "staff@x" });
    expect(warning.dueBy!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect((await fresh(s.id)).status).toBe("active"); // a warning doesn't stop sales

    const pause = await sendNotice(db, { shopId: s.id, kind: "paused", reason: "customer_complaints", explanation: `${why} Not fixed by the deadline.`, by: "staff@x" });
    expect(await fresh(s.id)).toMatchObject({ status: "paused", statusReason: "Buyers have complained about this store" });
    expect((await openNotices(db, s.id)).map((n) => n.kind)).toEqual(["paused", "warning"]);

    await expect(submitAppeal(db, s.id, pause.id, "fixed")).rejects.toThrow(/sentence/);
    const appeal = await submitAppeal(db, s.id, pause.id, "We switched to a supplier that includes plugs and refunded all three buyers.");
    await expect(submitAppeal(db, s.id, pause.id, "Another appeal while the first is still open.")).rejects.toThrow(/already have an appeal/);
    expect(await listOpenAppeals(db)).toHaveLength(1);

    expect(await decideAppeal(db, appeal.id, { accept: true, response: "Thanks, confirmed with the buyers.", by: "staff@x" })).toEqual({ reinstated: true });
    expect((await fresh(s.id)).status).toBe("active");
    expect(await openNotices(db, s.id)).toHaveLength(0);
    const all = await listNotices(db, s.id);
    expect(all[0]).toMatchObject({ kind: "reinstated" });
    expect(all.find((n) => n.id === pause.id)!.appeals[0]).toMatchObject({ status: "accepted" });
  });

  it("pauses straight away only for illegal products and identity", async () => {
    const s = await shop();
    await sendNotice(db, { shopId: s.id, kind: "paused", reason: "prohibited_product", explanation: "The listing 'Stun pen' is a weapon, which isn't allowed.", by: "staff@x" });
    expect((await fresh(s.id)).status).toBe("paused");
  });

  it("a rejected appeal keeps the notice open with the reply", async () => {
    const s = await shop();
    const n = await sendNotice(db, { shopId: s.id, kind: "warning", reason: "misleading_listing", explanation: "The photos show a wooden lamp; buyers get plastic.", by: "staff@x" });
    const a = await submitAppeal(db, s.id, n.id, "The supplier says it is wood-effect, which is close enough.");
    await decideAppeal(db, a.id, { accept: false, response: "Please say wood-effect in the title and description.", by: "staff@x" });
    const [notice] = await openNotices(db, s.id);
    expect(notice!.appeals[0]).toMatchObject({ status: "rejected", response: "Please say wood-effect in the title and description." });
  });
});

describe("store health", () => {
  it("warns a store that ships late too often, once a month", async () => {
    const s = await shop();
    const now = Date.now();
    await history(s.id, [...Array(8).fill({ shipDays: 3 }), { shipDays: 12 }, { shipDays: null }], now);
    const health = await storeHealth(db, s.id, new Date(now));
    expect(health).toMatchObject({ paidOrders: 10, onTimeRate: 0.8, lateTooOften: true, refundsTooOften: false });

    expect(await runHealthChecks(db, new Date(now))).toEqual({ checked: 1, warned: 1 });
    expect(await runHealthChecks(db, new Date(now))).toEqual({ checked: 1, warned: 0 });
    const [n] = await openNotices(db, s.id);
    expect(n).toMatchObject({ kind: "warning", reason: "late_shipping", createdBy: "Automatic check" });
    expect(n!.explanation).toContain("Only 80%");
    expect((await fresh(s.id)).status).toBe("active");
  });
});

describe("verified badge", () => {
  it("is earned by meeting every public rule, and lost on a pause", async () => {
    const s = await shop();
    const now = Date.now() + 31 * DAY;
    await history(s.id, Array(10).fill({ shipDays: 2 }), now);
    let check = await verifiedChecklist(db, await fresh(s.id), new Date(now));
    expect(check.items.filter((i) => !i.met).map((i) => i.key)).toEqual(["identity", "returns"]);

    await db.update(schema.shops).set({ payoutsEnabled: true }).where(eq(schema.shops.id, s.id));
    await createPage(db, s.id, { title: "Returns", body: "30 days, free returns.", published: true });
    check = await verifiedChecklist(db, await fresh(s.id), new Date(now));
    expect(check.met).toBe(true);
    const since = await refreshVerified(db, s.id, new Date(now));
    expect(since).toEqual(new Date(now));
    // Still qualifies the next day: the "since" date stays.
    expect(await refreshVerified(db, s.id, new Date(now + DAY))).toEqual(new Date(now));

    await sendNotice(db, { shopId: s.id, kind: "paused", reason: "identity", explanation: "The ID check on the payout account failed.", by: "staff@x" });
    expect((await fresh(s.id)).verifiedAt).toBeNull();
  });
});
