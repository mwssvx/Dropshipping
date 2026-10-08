import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@sf/db";
import {
  createProduct,
  createSession,
  createShop,
  FakePaymentProvider,
  ForbiddenError,
  getOrder,
  getSessionUser,
  handlePaymentEvent,
  listActiveProducts,
  listOrders,
  parseMoney,
  quoteCart,
  requireMember,
  signIn,
  signUp,
  startCheckout,
  updateProduct,
  UserError,
} from "../src";

const address = { name: "Ada Buyer", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

async function merchantWithProduct(price = 2500) {
  const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
  const shop = await createShop(db, user.id, { name: "Glow Lamps", country: "US" });
  const product = await createProduct(db, shop.id, {
    title: "Sunset Lamp",
    status: "active",
    variants: [{ title: "Default", priceMinor: price, costMinor: 800 }],
  });
  const full = (await listActiveProducts(db, shop.id))[0]!;
  return { user, shop, product, variant: full.variants[0]! };
}

describe("money", () => {
  it("parses prices people type", () => {
    expect(parseMoney("19.99")).toBe(1999);
    expect(parseMoney("19")).toBe(1900);
    expect(parseMoney("1,299.5")).toBe(129950);
    expect(() => parseMoney("abc")).toThrow();
  });
});

describe("auth", () => {
  it("signs up, signs in and resolves a session", async () => {
    const user = await signUp(db, { email: "A@Example.com", password: "long enough" });
    expect(user.email).toBe("a@example.com");
    await expect(signIn(db, { email: "a@example.com", password: "wrong pass" })).rejects.toThrow(UserError);
    const ok = await signIn(db, { email: "a@example.com", password: "long enough" });
    const { token } = await createSession(db, ok.id);
    expect((await getSessionUser(db, token))?.id).toBe(user.id);
    expect(await getSessionUser(db, "nope")).toBeNull();
  });

  it("rejects duplicate emails and short passwords", async () => {
    await signUp(db, { email: "a@example.com", password: "long enough" });
    await expect(signUp(db, { email: "a@example.com", password: "long enough" })).rejects.toThrow(/already exists/);
    await expect(signUp(db, { email: "b@example.com", password: "short" })).rejects.toThrow(/8 characters/);
  });
});

describe("shops", () => {
  it("gives each store a unique handle and the right currency", async () => {
    const u = await signUp(db, { email: "a@example.com", password: "long enough" });
    const a = await createShop(db, u.id, { name: "Glow Lamps!", country: "DE" });
    const b = await createShop(db, u.id, { name: "Glow Lamps", country: "GB" });
    expect(a.handle).toBe("glow-lamps");
    expect(b.handle).toBe("glow-lamps-2");
    expect(a.currency).toBe("EUR");
    expect(b.currency).toBe("GBP");
  });

  it("blocks countries outside the launch list", async () => {
    const u = await signUp(db, { email: "a@example.com", password: "long enough" });
    await expect(createShop(db, u.id, { name: "Shop", country: "BR" })).rejects.toThrow(/country/);
  });

  it("keeps merchants out of each other's stores", async () => {
    const { shop } = await merchantWithProduct();
    const other = await signUp(db, { email: "other@example.com", password: "long enough" });
    await expect(requireMember(db, other.id, shop.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("products", () => {
  it("updates variants and hides drafts from the storefront", async () => {
    const { shop, product } = await merchantWithProduct();
    await updateProduct(db, shop.id, product.id, {
      title: "Sunset Lamp",
      status: "draft",
      variants: [
        { title: "Small", priceMinor: 2000 },
        { title: "Large", priceMinor: 3000 },
      ],
    });
    expect(await listActiveProducts(db, shop.id)).toHaveLength(0);
  });
});

describe("checkout", () => {
  it("prices from the database, then a signed webhook marks the order paid exactly once", async () => {
    const { shop, variant } = await merchantWithProduct(2500);
    const payments = new FakePaymentProvider();
    const quote = await quoteCart(db, shop, [{ variantId: variant.id, quantity: 1 }]);
    expect(quote).toMatchObject({ subtotalMinor: 2500, shippingMinor: 499, totalMinor: 2999 });

    const { order } = await startCheckout(db, payments, shop, {
      email: "buyer@example.com",
      address,
      lines: [{ variantId: variant.id, quantity: 2 }],
    });
    expect(order).toMatchObject({ number: 1001, paymentStatus: "pending", shippingMinor: 0, totalMinor: 5000 });

    const { body, signature } = payments.succeededEvent(order.paymentIntentId!, 5000);
    const event = (await payments.parseWebhook(body, signature))!;
    expect(await handlePaymentEvent(db, "fake", event)).toMatchObject({ status: "processed" });
    expect(await handlePaymentEvent(db, "fake", event)).toMatchObject({ status: "duplicate" });

    const saved = await getOrder(db, shop.id, order.id);
    expect(saved.paymentStatus).toBe("paid");
    expect(saved.lines).toEqual([expect.objectContaining({ quantity: 2, unitPriceMinor: 2500, unitCostMinor: 800 })]);
  });

  it("numbers orders per store", async () => {
    const { shop, variant } = await merchantWithProduct();
    const payments = new FakePaymentProvider();
    const input = { email: "b@example.com", address, lines: [{ variantId: variant.id, quantity: 1 }] };
    await startCheckout(db, payments, shop, input);
    await startCheckout(db, payments, shop, input);
    expect((await listOrders(db, shop.id)).map((o) => o.number)).toEqual([1002, 1001]);
  });

  it("rejects forged webhooks and wrong amounts", async () => {
    const { shop, variant } = await merchantWithProduct();
    const payments = new FakePaymentProvider();
    const { order } = await startCheckout(db, payments, shop, {
      email: "b@example.com",
      address,
      lines: [{ variantId: variant.id, quantity: 1 }],
    });
    const { body } = payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await expect(payments.parseWebhook(body, "forged")).rejects.toThrow(/signature/);
    const wrong = payments.succeededEvent(order.paymentIntentId!, 1);
    await expect(handlePaymentEvent(db, "fake", (await payments.parseWebhook(wrong.body, wrong.signature))!)).rejects.toThrow(/mismatch/);
    expect((await getOrder(db, shop.id, order.id)).paymentStatus).toBe("pending");
  });

  it("refuses products from another store and empty carts", async () => {
    const { variant } = await merchantWithProduct();
    const u2 = await signUp(db, { email: "two@example.com", password: "long enough" });
    const shop2 = await createShop(db, u2.id, { name: "Other", country: "US" });
    await expect(quoteCart(db, shop2, [{ variantId: variant.id, quantity: 1 }])).rejects.toThrow(/no longer available/);
    await expect(quoteCart(db, shop2, [])).rejects.toThrow(/empty/);
  });
});
