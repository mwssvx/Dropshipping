import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  buyerOrders, DemoModel, getBuyer, handlePaymentEvent, lastCheckoutDetails, listCustomers, reorderLines, requestBuyerCode, signOutBuyer,
  startCheckout, verifyBuyerCode,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [lamp] = await f.variants(f.products.lamp.id);
  const [projector] = await f.variants(f.products.projector.id);
  const buy = async (email: string, lines: { variantId: string; quantity: number }[]) => {
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email, address, lines });
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    return order;
  };
  const codeFrom = (i = -1) => f.mailer.sent.at(i)!.subject.match(/^(\d{6})/)![1]!;
  return { ...f, lamp: lamp!, projector: projector!, buy, codeFrom };
}

describe("buyer accounts", () => {
  it("signs a shopper in with an emailed code and shows only their orders", async () => {
    const f = await setup();
    const shop = await f.shop();
    await f.buy("ada@example.com", [{ variantId: f.lamp.id, quantity: 2 }]);
    await f.buy("grace@example.com", [{ variantId: f.lamp.id, quantity: 1 }]);

    await requestBuyerCode(f, shop, " Ada@Example.com ");
    expect(f.mailer.sent.at(-1)).toMatchObject({ to: "ada@example.com" });
    expect(f.mailer.sent.at(-1)!.subject).toMatch(/^\d{6} is your Glow Lamps sign-in code$/);
    const { token, customer } = await verifyBuyerCode(f.db, shop.id, "ada@example.com", f.codeFrom());
    expect(customer.lastSignInAt).toBeInstanceOf(Date);
    expect(await getBuyer(f.db, shop.id, token)).toMatchObject({ email: "ada@example.com", name: "Ada Lovelace" });

    const orders = await buyerOrders(f.db, shop.id, "ada@example.com");
    expect(orders).toHaveLength(1);
    expect(orders[0]!.items).toEqual([expect.objectContaining({ title: "Sunset Projection Lamp – Small", quantity: 2 })]);
    expect(await lastCheckoutDetails(f.db, shop.id, "ada@example.com")).toEqual({ email: "ada@example.com", address });

    // The session only works for this store, and signing out ends it.
    expect(await getBuyer(f.db, "00000000-0000-0000-0000-000000000000", token)).toBeNull();
    await signOutBuyer(f.db, token);
    expect(await getBuyer(f.db, shop.id, token)).toBeNull();
  });

  it("limits wrong codes, old codes and how many codes are sent", async () => {
    const f = await setup();
    const shop = await f.shop();
    await requestBuyerCode(f, shop, "ada@example.com");
    const code = f.codeFrom();
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(verifyBuyerCode(f.db, shop.id, "ada@example.com", wrong)).rejects.toThrow("4 tries left");
    for (let i = 0; i < 4; i++) await expect(verifyBuyerCode(f.db, shop.id, "ada@example.com", wrong)).rejects.toThrow("isn't right");
    await expect(verifyBuyerCode(f.db, shop.id, "ada@example.com", code)).rejects.toThrow("expired");

    await requestBuyerCode(f, shop, "ada@example.com");
    await expect(verifyBuyerCode(f.db, shop.id, "ada@example.com", f.codeFrom(), new Date(Date.now() + 11 * 60_000))).rejects.toThrow("expired");
    for (let i = 0; i < 3; i++) await requestBuyerCode(f, shop, "ada@example.com");
    await expect(requestBuyerCode(f, shop, "ada@example.com")).rejects.toThrow("several codes");
    // A code with a space in it still works.
    const latest = f.codeFrom();
    await expect(verifyBuyerCode(f.db, shop.id, "ada@example.com", `${latest.slice(0, 3)} ${latest.slice(3)}`)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it("buys again with what's still for sale", async () => {
    const f = await setup();
    const shop = await f.shop();
    const order = await f.buy("ada@example.com", [{ variantId: f.lamp.id, quantity: 2 }, { variantId: f.projector.id, quantity: 1 }]);
    expect(await reorderLines(f.db, shop.id, "ada@example.com", order.id)).toEqual({ lines: [{ variantId: f.lamp.id, quantity: 2 }, { variantId: f.projector.id, quantity: 1 }], missing: 0 });
    await f.db.update(schema.products).set({ status: "draft" }).where(eq(schema.products.id, f.products.projector.id));
    expect(await reorderLines(f.db, shop.id, "ada@example.com", order.id)).toEqual({ lines: [{ variantId: f.lamp.id, quantity: 2 }], missing: 1 });
    await expect(reorderLines(f.db, shop.id, "grace@example.com", order.id)).rejects.toThrow("couldn't find");
  });

  it("lists customers with their orders and spend for the merchant", async () => {
    const f = await setup();
    const shop = await f.shop();
    const first = await f.buy("ada@example.com", [{ variantId: f.lamp.id, quantity: 1 }]);
    const second = await f.buy("ada@example.com", [{ variantId: f.lamp.id, quantity: 1 }]);
    await f.buy("grace@example.com", [{ variantId: f.lamp.id, quantity: 1 }]);
    await startCheckout(f.db, f.payments, shop, { email: "linus@example.com", address, lines: [{ variantId: f.lamp.id, quantity: 1 }] });

    const customers = await listCustomers(f.db, shop.id);
    const ada = customers.find((c) => c.email === "ada@example.com")!;
    expect(ada).toMatchObject({ orders: 2, spentMinor: first.totalMinor + second.totalMinor, lastSignInAt: null });
    expect(customers.find((c) => c.email === "linus@example.com")).toMatchObject({ orders: 0, spentMinor: 0, lastOrderAt: null });
    expect((await listCustomers(f.db, shop.id, { query: "GRACE" })).map((c) => c.email)).toEqual(["grace@example.com"]);
  });
});
