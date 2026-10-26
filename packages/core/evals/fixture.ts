// A store with products and orders in every state the agents deal with. Used by the agent tests
// and the eval suite, so both run against the same, realistic data.
import { eq } from "drizzle-orm";
import { createTestDb, schema, type Db } from "@sf/db";
import {
  createPage,
  createShop,
  DEMO_SUPPLIER_LINKS,
  FakePaymentProvider,
  FakeSupplier,
  handlePaymentEvent,
  importProduct,
  LogMailer,
  onOrderPaid,
  signUp,
  startCheckout,
  suppliersFrom,
  syncTracking,
  type AgentContext,
  type ModelClient,
} from "../src";

export const DAY = 86_400_000;
/** A postal code in the right shape for each country the tests ship to. */
const POSTAL: Record<string, string> = { US: "78701", JP: "100-0001", GB: "SW1A 1AA", CA: "K1A 0B1", DE: "10115", FR: "75001" };
const LAMP = DEMO_SUPPLIER_LINKS[0]!;
const STAND = DEMO_SUPPLIER_LINKS[1]!;
const PROJECTOR = DEMO_SUPPLIER_LINKS[2]!; // sells out when ordered

export type Fixture = Awaited<ReturnType<typeof makeFixture>>;

export async function makeFixture(model: ModelClient, opts: { country?: string } = {}) {
  const db: Db = await createTestDb();
  let clock = Date.now();
  const mailer = new LogMailer(true);
  const payments = new FakePaymentProvider();
  const ctx: AgentContext = {
    db,
    payments,
    model,
    mailer,
    suppliers: suppliersFrom([new FakeSupplier({ shipAfterMs: DAY, deliverAfterMs: 6 * DAY, now: () => clock })]),
    orderStatusUrl: (shop, order) => `https://${shop.handle}.example/orders/${order.paymentIntentId}`,
    supplierPortalUrl: (token) => `https://app.example/supplier/${token}`,
    now: () => new Date(clock),
  };
  const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
  const created = await createShop(db, user.id, { name: "Glow Lamps", country: opts.country ?? "US" });
  const shop = async () => (await db.query.shops.findFirst({ where: eq(schema.shops.id, created.id) }))!;

  const lamp = await importProduct(db, ctx.suppliers, created.id, { url: LAMP, title: "Sunset Projection Lamp", prices: {}, publish: true });
  const stand = await importProduct(db, ctx.suppliers, created.id, { url: STAND, title: "HOT SALE 2024 NEW Magnetic Phone Stand MPS-200 Free Shipping", prices: {}, publish: false });
  const projector = await importProduct(db, ctx.suppliers, created.id, { url: PROJECTOR, title: "Galaxy Projector", prices: {}, publish: true });
  const variants = async (productId: string) =>
    db.query.variants.findMany({ where: eq(schema.variants.productId, productId), orderBy: schema.variants.position });

  let n = 0;
  async function order(productId: string, o: { country?: string; name?: string; note?: string } = {}) {
    const [v] = await variants(productId);
    const { order } = await startCheckout(db, payments, await shop(), {
      email: `buyer${++n}@example.com`,
      address: { name: o.name ?? "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: POSTAL[o.country ?? "US"] ?? "78701", country: o.country ?? "US" },
      lines: [{ variantId: v!.id, quantity: 1 }],
      note: o.note,
    });
    const { body, signature } = payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(db, "fake", (await payments.parseWebhook(body, signature))!);
    await onOrderPaid(ctx, order.id);
    return (await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
  }

  /** Paid and sent to the supplier, no tracking yet. */
  const waitingOrder = () => order(lamp.id);
  /** Shipped with tracking. */
  async function shippedOrder() {
    const o = await order(lamp.id);
    clock += DAY + 1;
    await syncTracking(ctx, { orderId: o.id });
    return (await db.query.orders.findFirst({ where: eq(schema.orders.id, o.id) }))!;
  }
  /** The supplier ran out of stock. */
  const outOfStockOrder = () => order(projector.id);
  /** The supplier doesn't ship to this country. */
  const badAddressOrder = () => order(lamp.id, { country: "JP" });

  const returnsPage = () =>
    createPage(db, created.id, { title: "Returns", body: "You can return anything within 30 days of delivery for a full refund. Items must be unused and in their original box." });

  const setShop = (v: Partial<typeof schema.shops.$inferInsert>) => db.update(schema.shops).set(v).where(eq(schema.shops.id, created.id));
  const pending = () => db.query.agentActions.findMany({ where: eq(schema.agentActions.status, "pending") });
  const actions = () => db.query.agentActions.findMany({ orderBy: schema.agentActions.createdAt });

  return {
    db,
    ctx,
    mailer,
    payments,
    shop,
    setShop,
    products: { lamp, stand, projector },
    variants,
    order,
    waitingOrder,
    shippedOrder,
    outOfStockOrder,
    badAddressOrder,
    returnsPage,
    pending,
    actions,
    advance: (ms: number) => (clock += ms),
  };
}
