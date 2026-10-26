import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  applyAllTagRules,
  createShop,
  createTagRule,
  deleteTagRule,
  DemoModel,
  describeTagRule,
  exportStore,
  handlePaymentEvent,
  importStore,
  listTagRules,
  onOrderPaid,
  refundOrder,
  signUp,
  startCheckout,
  updateCustomerNotes,
} from "../src";
import { DAY, makeFixture, type Fixture } from "../evals/fixture";

async function buy(f: Fixture, email: string, productId: string, quantity = 1) {
  const [v] = await f.variants(productId);
  const { order } = await startCheckout(f.db, f.payments, await f.shop(), {
    email,
    address: { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" },
    lines: [{ variantId: v!.id, quantity }],
  });
  const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
  await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
  await onOrderPaid(f.ctx, order.id);
  return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
}

const customer = (f: Fixture, email: string) => f.db.query.customers.findFirst({ where: eq(schema.customers.email, email) }).then((c) => c!);

describe("tag rules", () => {
  it("tags customers who match, keeps the tag in step, and leaves hand-typed tags alone", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const first = await buy(f, "ada@example.com", f.products.lamp.id);
    await buy(f, "grace@example.com", f.products.lamp.id);
    // Grace was already tagged by hand.
    await updateCustomerNotes(f.db, shop.id, (await customer(f, "grace@example.com")).id, { tags: "repeat, friend" });

    // An existing customer who matches is tagged straight away.
    const { applied } = await createTagRule(f.db, shop.id, { kind: "orders", tag: " Repeat ", threshold: 2 });
    expect(applied).toEqual({ tagged: 0, untagged: 0 });
    await createTagRule(f.db, shop.id, { kind: "spent", tag: "vip", threshold: first.totalMinor * 2 });
    await expect(createTagRule(f.db, shop.id, { kind: "spent", tag: "vip", threshold: first.totalMinor * 2 })).rejects.toThrow("already here");
    await expect(createTagRule(f.db, shop.id, { kind: "spent", tag: "vip, big", threshold: 100 })).rejects.toThrow("one tag");
    await expect(createTagRule(f.db, shop.id, { kind: "bought", tag: "lamp", productId: "nope" })).rejects.toThrow("Pick the product");
    await expect(createTagRule(f.db, shop.id, { kind: "lapsed", tag: "gone", threshold: 3 })).rejects.toThrow("at least 7 days");

    // Ada's second order makes her a repeat buyer and a vip, the moment it's paid.
    const second = await buy(f, "ada@example.com", f.products.lamp.id);
    let ada = await customer(f, "ada@example.com");
    expect(ada.tags).toEqual(["repeat", "vip"]);
    expect(ada.autoTags).toEqual(["repeat", "vip"]);

    // A refund takes her under the amount; the scheduled job takes that tag off. A refunded order
    // still counts as an order, as on the customer list.
    await refundOrder(f.ctx, shop.id, second.id, {});
    expect(await applyAllTagRules(f.db)).toMatchObject({ shops: 1, untagged: 1 });
    ada = await customer(f, "ada@example.com");
    expect(ada.tags).toEqual(["repeat"]);

    // Grace's hand-typed "repeat" stays, though she placed one order.
    expect((await customer(f, "grace@example.com")).tags).toEqual(["repeat", "friend"]);

    const rules = await listTagRules(f.db, shop.id);
    expect(rules.map((r) => [r.tag, describeTagRule(r, shop.currency)])).toEqual([
      ["repeat", "Placed 2 or more orders"],
      ["vip", `Spent $${((first.totalMinor * 2) / 100).toFixed(2)} or more`],
    ]);
  });

  it("tags buyers of a product and customers who stopped ordering, and untags when a rule goes", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await buy(f, "ada@example.com", f.products.lamp.id);
    await buy(f, "grace@example.com", f.products.projector.id);

    const { rule: lampRule } = await createTagRule(f.db, shop.id, { kind: "bought", tag: "lamp owner", productId: f.products.lamp.id });
    expect((await customer(f, "ada@example.com")).tags).toEqual(["lamp owner"]);
    expect((await customer(f, "grace@example.com")).tags).toEqual([]);

    const later = new Date(Date.now() + 31 * DAY);
    await createTagRule(f.db, shop.id, { kind: "lapsed", tag: "lapsed", threshold: 30 }, { now: later });
    expect((await customer(f, "grace@example.com")).tags).toEqual(["lapsed"]);
    expect((await listTagRules(f.db, shop.id)).find((r) => r.tag === "lapsed")).toMatchObject({ customers: 2 });

    // Grace orders again: not lapsed any more.
    await buy(f, "grace@example.com", f.products.lamp.id);
    expect((await customer(f, "grace@example.com")).tags).toEqual(["lamp owner"]);

    // The rule goes, and so does its tag.
    expect((await deleteTagRule(f.db, shop.id, lampRule.id, { now: later })).applied).toMatchObject({ untagged: 2 });
    expect((await customer(f, "ada@example.com")).tags).toEqual(["lapsed"]);

    // The rules travel in the store file, the product by its address.
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    await createTagRule(f.db, shop.id, { kind: "bought", tag: "projector owner", productId: f.products.projector.id });
    const withProduct = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.tag_rules).toEqual([{ tag: "lapsed", kind: "lapsed", threshold: 30 }]);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    expect(await importStore(f.db, copy.id, withProduct)).toMatchObject({ tagRules: 2 });
    const copied = await listTagRules(f.db, copy.id);
    expect(copied.map((r) => [r.tag, r.productTitle])).toEqual([
      ["lapsed", null],
      ["projector owner", "Galaxy Projector"],
    ]);
  });
});
