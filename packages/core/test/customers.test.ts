import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  customerTags,
  DemoModel,
  eraseCustomer,
  erasedEmail,
  exportCustomerData,
  getCustomerProfile,
  listCustomers,
  normalizeTags,
  startBuyerMessage,
  submitReview,
  updateCustomerNotes,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const customerFor = async (f: Awaited<ReturnType<typeof makeFixture>>, email: string) =>
  (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, email) }))!;

describe("customer profiles", () => {
  it("shows a buyer's orders, spend and addresses, and keeps the merchant's note and tags", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const first = await f.shippedOrder();
    const customer = await customerFor(f, first.email);

    const profile = await getCustomerProfile(f.db, shop.id, customer.id);
    expect(profile.stats).toMatchObject({ orders: 1, spentMinor: first.totalMinor, averageMinor: first.totalMinor });
    expect(profile.orders).toEqual([expect.objectContaining({ id: first.id, number: first.number, items: 1 })]);
    expect(profile.addresses).toEqual([first.shippingAddress]);
    expect(profile.storeCreditMinor).toBe(0);

    expect(normalizeTags("VIP,  wholesale   lead , vip,")).toEqual(["vip", "wholesale lead"]);
    expect(() => normalizeTags("x".repeat(31))).toThrow("30 characters");
    expect(() => normalizeTags(Array.from({ length: 11 }, (_, i) => `t${i}`))).toThrow("up to 10 tags");
    await updateCustomerNotes(f.db, shop.id, customer.id, { note: "  Prefers gift wrap.  ", tags: "VIP, repeat" });
    expect(await customerFor(f, first.email)).toMatchObject({ note: "Prefers gift wrap.", tags: ["vip", "repeat"] });
    await updateCustomerNotes(f.db, shop.id, customer.id, { note: "" });
    expect(await customerFor(f, first.email)).toMatchObject({ note: null, tags: ["vip", "repeat"] });

    expect(await customerTags(f.db, shop.id)).toEqual([{ tag: "repeat", count: 1 }, { tag: "vip", count: 1 }]);
    expect((await listCustomers(f.db, shop.id, { tag: "vip" })).map((c) => c.email)).toEqual([first.email]);
    expect(await listCustomers(f.db, shop.id, { tag: "nobody" })).toEqual([]);

    // Another store can't open or change this customer.
    await expect(getCustomerProfile(f.db, "00000000-0000-0000-0000-000000000000", customer.id)).rejects.toThrow("Customer not found");
    await expect(getCustomerProfile(f.db, shop.id, "not-a-uuid")).rejects.toThrow("Customer not found");
  });

  it("exports a buyer's data, then erases it once their orders are done", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const order = await f.shippedOrder();
    const email = order.email;
    const customer = await customerFor(f, email);
    await startBuyerMessage(f.db, { shopId: shop.id, paymentIntentId: order.paymentIntentId!, body: "Where is my lamp?" });
    await submitReview(f.db, shop, order.paymentIntentId!, { productId: f.products.lamp.id, rating: 5, name: "Ada L.", body: "Lovely warm light, works great." });

    const data = await exportCustomerData(f.db, shop, customer.id);
    expect(data.customer.email).toBe(email);
    expect(data.orders).toEqual([expect.objectContaining({ number: order.number, email, shipping_address: order.shippingAddress })]);
    expect(data.messages.map((m) => m.body)).toContain("Where is my lamp?");
    expect(data.reviews).toEqual([expect.objectContaining({ name: "Ada L.", rating: 5 })]);
    expect(data.emails_sent.length).toBeGreaterThan(0);

    // Another order is still on its way, so erasing waits.
    const waiting = await f.order(f.products.lamp.id);
    expect(waiting.email).not.toBe(email);
    await expect(eraseCustomer(f.db, shop.id, customer.id, { confirmEmail: "someone@else.com" })).rejects.toThrow("Type the customer's email");
    const sameBuyer = await f.db.update(schema.orders).set({ email }).where(eq(schema.orders.id, waiting.id)).returning();
    await expect(eraseCustomer(f.db, shop.id, customer.id, { confirmEmail: email })).rejects.toThrow(`Order #${sameBuyer[0]!.number} hasn't reached them yet`);
    f.advance(DAY + 1);
    await f.db.update(schema.orders).set({ fulfillmentStatus: "delivered" }).where(eq(schema.orders.id, waiting.id));

    const result = await eraseCustomer(f.db, shop.id, customer.id, { confirmEmail: email.toUpperCase() });
    expect(result).toEqual({ orders: 2 });
    expect(await f.db.query.customers.findFirst({ where: eq(schema.customers.id, customer.id) })).toBeUndefined();
    const after = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    expect(after.email).toBe(erasedEmail(customer.id));
    expect(after.shippingAddress).toEqual({ name: "Erased", line1: "Erased", city: "Erased", postalCode: "78701", country: "US", region: "TX" });
    expect(after.totalMinor).toBe(order.totalMinor);
    expect(await f.db.query.conversations.findMany({ where: eq(schema.conversations.email, email) })).toEqual([]);
    expect(await f.db.query.emails.findMany({ where: eq(schema.emails.to, email) })).toEqual([]);
    expect((await f.db.query.reviews.findFirst({ where: eq(schema.reviews.orderId, order.id) }))!.name).toBe("Verified buyer");
    expect(JSON.stringify(await f.db.query.orders.findMany())).not.toContain(email);
  });
});
