import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, eraseCustomer, listOrders, orderTags, publicOrder, startCheckout, updateOrderNotes } from "../src";
import { makeFixture } from "../evals/fixture";

describe("order notes and tags", () => {
  it("keeps the buyer's note, and the merchant's own note and tags", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const first = await f.order(f.products.lamp.id, { note: "  Please leave it with the neighbour at no. 3.  ", name: "Grace Hopper" });
    expect(first.buyerNote).toBe("Please leave it with the neighbour at no. 3.");
    const receipt = f.mailer.sent.find((m) => m.to === first.email && m.subject === `Order #${first.number} confirmed`);
    expect(receipt?.text).toContain("Your note to Glow Lamps: Please leave it with the neighbour at no. 3.");
    const [lamp] = await f.variants(f.products.lamp.id);
    await expect(
      startCheckout(f.db, f.payments, shop, {
        email: "ada@example.com",
        address: { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" },
        lines: [{ variantId: lamp!.id, quantity: 1 }],
        note: "x".repeat(501),
      }),
    ).rejects.toThrow("under 500 characters");

    const second = await f.waitingOrder();
    expect(second.buyerNote).toBeNull();
    await updateOrderNotes(f.db, shop.id, first.id, { note: "  Called them about the neighbour. ", tags: "Follow up, VIP" });
    await updateOrderNotes(f.db, shop.id, second.id, { tags: ["vip"] });
    expect(await f.db.query.orders.findFirst({ where: eq(schema.orders.id, first.id) })).toMatchObject({ staffNote: "Called them about the neighbour.", tags: ["follow up", "vip"] });
    await expect(updateOrderNotes(f.db, shop.id, first.id, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).rejects.toThrow("An order can have up to 10 tags");

    expect(await orderTags(f.db, shop.id)).toEqual([{ tag: "vip", count: 2 }, { tag: "follow up", count: 1 }]);
    expect((await listOrders(f.db, shop.id, { tag: "Follow up" })).map((o) => o.id)).toEqual([first.id]);
    expect((await listOrders(f.db, shop.id, { tag: "vip" })).map((o) => o.id)).toEqual([second.id, first.id]);
    expect((await listOrders(f.db, shop.id, { query: `#${second.number}` })).map((o) => o.id)).toEqual([second.id]);
    expect((await listOrders(f.db, shop.id, { query: "grace" })).map((o) => o.id)).toEqual([first.id]);
    expect(await listOrders(f.db, shop.id, { query: "12345678901234" })).toEqual([]);
    expect((await listOrders(f.db, shop.id, { query: first.email.toUpperCase() })).map((o) => o.id)).toEqual([first.id]);

    // Saving only the tags keeps the note.
    await updateOrderNotes(f.db, shop.id, first.id, { tags: "" });
    const saved = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, first.id) }))!;
    expect(saved).toMatchObject({ staffNote: "Called them about the neighbour.", tags: [] });
    expect(publicOrder(saved)).toMatchObject({ buyer_note: "Please leave it with the neighbour at no. 3.", note: "Called them about the neighbour.", tags: [] });

    // Erasing the buyer clears both notes: they're free text and may be about them.
    const customer = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, first.email) }))!;
    await f.db.update(schema.fulfillments).set({ status: "delivered" }).where(eq(schema.fulfillments.orderId, first.id));
    await f.db.update(schema.orders).set({ fulfillmentStatus: "delivered" }).where(eq(schema.orders.id, first.id));
    await eraseCustomer(f.db, shop.id, customer.id, { confirmEmail: first.email });
    expect(await f.db.query.orders.findFirst({ where: eq(schema.orders.id, first.id) })).toMatchObject({ buyerNote: null, staffNote: null });
  });
});
