import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { eq } from "drizzle-orm";
import {
  cleanPersonalization,
  DemoModel,
  exportStore,
  FakeSupplier,
  handlePaymentEvent,
  onOrderPaid,
  quoteCart,
  sendReplacement,
  setPersonalization,
  startCheckout,
  syncTracking,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("personalised products", () => {
  it("checks the fields the merchant sets up", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const id = f.products.lamp.id;
    const field = { label: "Name to engrave", required: true, maxLength: 12 };
    await expect(setPersonalization(f.db, shop.id, id, [{ ...field, label: " " }])).rejects.toThrow("Give each field a label");
    await expect(setPersonalization(f.db, shop.id, id, [{ ...field, maxLength: 0 }])).rejects.toThrow("at least 1 character");
    await expect(setPersonalization(f.db, shop.id, id, [{ ...field, maxLength: 201 }])).rejects.toThrow("up to 200 characters");
    await expect(setPersonalization(f.db, shop.id, id, [field, { ...field, label: "name to ENGRAVE" }])).rejects.toThrow("different label");
    await expect(setPersonalization(f.db, shop.id, id, [1, 2, 3, 4].map((n) => ({ ...field, label: `Line ${n}` })))).rejects.toThrow("Up to 3 fields");
    await expect(setPersonalization(f.db, shop.id, "00000000-0000-0000-0000-000000000000", [field])).rejects.toThrow();

    const [name] = await setPersonalization(f.db, shop.id, id, [field]);
    // Editing keeps the id, so carts already holding text still match.
    const edited = await setPersonalization(f.db, shop.id, id, [{ ...field, id: name!.id, maxLength: 20 }, { label: "Gift note", required: false, maxLength: 80 }]);
    expect(edited[0]).toEqual({ id: name!.id, label: "Name to engrave", required: true, maxLength: 20 });
    expect(edited[1]!.id).not.toBe(name!.id);
    expect(cleanPersonalization(edited, { [name!.id]: "  Ada\n  Lovelace the First of Many  ", other: "x" })).toEqual({ [name!.id]: "Ada Lovelace the Fir" });
    expect(cleanPersonalization(edited, { [name!.id]: "   " })).toBeUndefined();
  });

  it("carries the buyer's text to the order, the receipt and the supplier", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [name, note] = await setPersonalization(f.db, shop.id, f.products.lamp.id, [
      { label: "Name to engrave", required: true, maxLength: 12 },
      { label: "Gift note", required: false, maxLength: 80 },
    ]);
    const [v] = await f.variants(f.products.lamp.id);

    // The same lamp with two names is two lines; stock counts both.
    const quote = await quoteCart(f.db, shop, [
      { variantId: v!.id, quantity: 1, custom: { [name!.id]: "Ada" } },
      { variantId: v!.id, quantity: 2, custom: { [name!.id]: "Grace", [note!.id]: "Happy birthday!" } },
    ]);
    expect(quote.items.map((i) => [i.quantity, i.personalization?.map((p) => p.value)])).toEqual([
      [1, ["Ada"]],
      [2, ["Grace", "Happy birthday!"]],
    ]);
    expect(new Set(quote.items.map((i) => i.key)).size).toBe(2);
    expect(quote.items[0]!.unitPriceMinor).toBe(quote.items[1]!.unitPriceMinor);
    await f.db.update(schema.variants).set({ stock: 2 }).where(eq(schema.variants.id, v!.id));
    await expect(quoteCart(f.db, shop, [
      { variantId: v!.id, quantity: 1, custom: { [name!.id]: "Ada" } },
      { variantId: v!.id, quantity: 2, custom: { [name!.id]: "Grace" } },
    ])).rejects.toThrow("Only 2 of");
    await f.db.update(schema.variants).set({ stock: null }).where(eq(schema.variants.id, v!.id));

    // A required field left empty shows in the cart and stops checkout.
    const empty = await quoteCart(f.db, shop, [{ variantId: v!.id, quantity: 1 }]);
    expect(empty.items[0]!.missingPersonalization).toEqual(["Name to engrave"]);
    await expect(startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: [{ variantId: v!.id, quantity: 1 }] })).rejects.toThrow(
      "Add Name to engrave for Sunset Projection Lamp – Small before checking out.",
    );

    const { order } = await startCheckout(f.db, f.payments, shop, {
      email: "ada@example.com",
      address,
      lines: [{ variantId: v!.id, quantity: 1, custom: { [name!.id]: "Ada", [note!.id]: "Love, Grace" } }],
    });
    const [line] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    expect(line!.personalization).toEqual([
      { fieldId: name!.id, label: "Name to engrave", value: "Ada" },
      { fieldId: note!.id, label: "Gift note", value: "Love, Grace" },
    ]);
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);

    const receipt = f.mailer.sent.find((m) => m.to === "ada@example.com" && m.subject.includes(`#${order.number}`));
    expect(receipt?.text).toContain("Name to engrave: Ada · Gift note: Love, Grace");
    const supplier = f.ctx.suppliers.get("fake") as FakeSupplier;
    expect(supplier.placed.at(-1)?.lines).toEqual([expect.objectContaining({ quantity: 1, note: "Name to engrave: Ada · Gift note: Love, Grace" })]);

    // A free replacement keeps the text.
    f.advance(86_400_000 + 1);
    await syncTracking(f.ctx, { orderId: order.id });
    const replacement = await sendReplacement(f.ctx, shop, order.id, { items: [{ lineId: line!.id, quantity: 1 }] });
    const [copy] = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, replacement.id) });
    expect(copy!.personalization).toEqual(line!.personalization);
    expect(supplier.placed.at(-1)?.lines[0]?.note).toBe("Name to engrave: Ada · Gift note: Love, Grace");

    // Store files carry the fields.
    const file = await exportStore(f.db, shop.id);
    expect(JSON.stringify(file)).toContain('"personalization":[{"label":"Name to engrave","required":true,"max_length":12}');
  });
});
