import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { abandonedCheckouts, DemoModel, handlePaymentEvent, sendAbandonedCartEmails, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const HOUR = 3_600_000;

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [lamp] = await f.variants(f.products.lamp.id);
  const checkout = async (email: string, quantity = 1) =>
    (await startCheckout(f.db, f.payments, await f.shop(), { email, address, lines: [{ variantId: lamp!.id, quantity }] })).order;
  const pay = async (order: { paymentIntentId: string | null; totalMinor: number }) => {
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
  };
  return { ...f, checkout, pay };
}

describe("abandoned checkouts", () => {
  it("lists unpaid checkouts an hour on, with the reminders sent and who came back to pay", async () => {
    const f = await setup();
    const shop = await f.shop();
    const ada = await f.checkout("ada@example.com", 2);
    const grace = await f.checkout("grace@example.com");
    const later = new Date(Date.now() + 2 * HOUR);
    expect((await abandonedCheckouts(f.db, shop.id)).checkouts).toEqual([]);

    const ctx = { ...f.ctx, payUrl: (_: unknown, o: { id: string }) => `https://store.example/pay/${o.id}` };
    await sendAbandonedCartEmails(ctx, later);
    // Once reminded, a checkout shows straight away, even inside the hour.
    expect((await abandonedCheckouts(f.db, shop.id)).checkouts.map((c) => c.number)).toEqual([grace.number, ada.number]);
    // Grace comes back and pays a new checkout instead.
    const again = await f.checkout("Grace@Example.com");
    await f.pay(again);
    // Ada pays the one she left, after the reminder.
    await f.pay(ada);

    const { checkouts, totals, older } = await abandonedCheckouts(f.db, shop.id, { now: later });
    expect(checkouts.map((c) => c.number)).toEqual([grace.number, ada.number]);
    expect(checkouts.find((c) => c.id === ada.id)).toMatchObject({ email: "ada@example.com", name: "Ada Lovelace", items: 2, reminded: true, offered: false, recoveredBy: ada.number });
    expect(checkouts.find((c) => c.id === grace.id)).toMatchObject({ reminded: true, recoveredBy: again.number });
    expect(totals).toEqual({ count: 2, valueMinor: ada.totalMinor + grace.totalMinor, recovered: 2 });
    expect(older).toBeNull();
  });

  it("leaves out payment links, paid orders nobody was reminded about, and old checkouts, and pages by number", async () => {
    const f = await setup();
    const shop = await f.shop();
    const made = [];
    for (let i = 0; i < 3; i++) made.push(await f.checkout(`buyer${i}@example.com`));
    const paid = await f.checkout("paid@example.com");
    await f.pay(paid);
    const link = await f.checkout("link@example.com");
    await f.db.update(schema.orders).set({ source: "payment_link" }).where(eq(schema.orders.id, link.id));
    const old = await f.checkout("old@example.com");
    await f.db.update(schema.orders).set({ createdAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(schema.orders.id, old.id));

    const now = new Date(Date.now() + 2 * HOUR);
    const first = await abandonedCheckouts(f.db, shop.id, { now, size: 2 });
    expect(first.checkouts.map((c) => c.number)).toEqual([made[2]!.number, made[1]!.number]);
    expect(first.totals).toMatchObject({ count: 3, recovered: 0 });
    const next = await abandonedCheckouts(f.db, shop.id, { now, size: 2, before: first.older! });
    expect(next.checkouts.map((c) => c.number)).toEqual([made[0]!.number]);
    expect(next.older).toBeNull();
    expect(next.checkouts[0]).toMatchObject({ reminded: false, offered: false, recoveredBy: null });
  });
});
