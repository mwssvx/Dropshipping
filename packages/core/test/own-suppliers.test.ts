import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  addOwnSupplier, createShop, DemoModel, exportStore, importStore, listOwnSuppliers, refundOrder, removeOwnSupplier, resetSupplierLink, retryOrder,
  setProductSupplier, signUp, supplierCantSend, supplierLabel, supplierMarkShipped, supplierPortal, syncTracking, updateOwnSupplier,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const maker = await addOwnSupplier(f.db, shop.id, { name: "Austin Woodworks", email: "Orders@AustinWood.example" });
  await setProductSupplier(f.db, shop.id, f.products.lamp.id, maker.id);
  const poMails = () => f.mailer.sent.filter((m) => m.to === "orders@austinwood.example");
  const fulfillment = async (orderId: string) => (await f.db.query.fulfillments.findFirst({ where: eq(schema.fulfillments.orderId, orderId) }))!;
  const order = async (id: string) => (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, id) }))!;
  return { ...f, shop, maker, poMails, fulfillment, orderRow: order };
}

describe("own suppliers", () => {
  it("emails the supplier a purchase order without the buyer's email, and their tracking reaches the buyer", async () => {
    const f = await setup();
    const o = await f.order(f.products.lamp.id);
    const po = f.poMails().at(-1)!;
    expect(po.subject).toBe(`New order PO-${o.number} from Glow Lamps`);
    expect(po.text).toContain("1 × Sunset Projection Lamp");
    expect(po.text).toContain("Ada Lovelace");
    expect(po.text).not.toContain(o.email);
    expect(po.text).toMatch(/add the tracking number here \(no account needed\): https:\/\/app\.example\/supplier\/[0-9a-f]{64}/);
    expect((await f.fulfillment(o.id)).status).toBe("placed");
    expect((await f.orderRow(o.id)).fulfillmentStatus).toBe("sent_to_supplier");

    const token = (await f.db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, f.maker.id) }))!.portalToken;
    const portal = (await supplierPortal(f.db, token))!;
    expect(portal.supplier.name).toBe("Austin Woodworks");
    expect(portal.toSend).toHaveLength(1);
    expect(portal.toSend[0]).toMatchObject({ ref: `PO-${o.number}`, items: [{ title: "Sunset Projection Lamp – Small", quantity: 1 }] });
    expect(portal.toSend[0]!.shipTo).toContain("Ada Lovelace");
    expect(await supplierPortal(f.db, "0".repeat(64))).toBeNull();

    // The demo supplier sync never asks anyone about own-supplier orders.
    f.advance(DAY * 2);
    expect(await syncTracking(f.ctx, { orderId: o.id })).toMatchObject({ checked: 1, errors: 0, shipped: 0 });

    await expect(supplierMarkShipped(f.ctx, token, portal.toSend[0]!.id, { carrier: "UPS", trackingNumber: "" })).rejects.toThrow("tracking number");
    await supplierMarkShipped(f.ctx, token, portal.toSend[0]!.id, { carrier: "UPS", trackingNumber: "1Z999AA10123456784" });
    expect(await f.orderRow(o.id)).toMatchObject({ fulfillmentStatus: "shipped" });
    expect(f.mailer.sent.find((m) => m.to === o.email && m.subject.includes("on its way"))!.text).toContain("UPS: 1Z999AA10123456784");
    await expect(supplierMarkShipped(f.ctx, token, portal.toSend[0]!.id, { carrier: "UPS", trackingNumber: "1Z999AA10123456784" })).rejects.toThrow("already");
    const after = (await supplierPortal(f.db, token))!;
    expect(after.toSend).toHaveLength(0);
    expect(after.sent[0]).toMatchObject({ status: "shipped", carrier: "UPS" });
    // Shipped own-supplier orders drop out of the tracking sync.
    expect(await syncTracking(f.ctx, { orderId: o.id })).toMatchObject({ checked: 0 });
  });

  it("a supplier who can't send it turns the order into a problem the merchant can retry", async () => {
    const f = await setup();
    const o = await f.order(f.products.lamp.id);
    const token = (await f.db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, f.maker.id) }))!.portalToken;
    const fid = (await f.fulfillment(o.id)).id;
    await supplierCantSend(f.ctx, token, fid, { reason: "out_of_stock", note: "Back in two weeks" });
    expect(await f.fulfillment(o.id)).toMatchObject({
      status: "failed",
      problemCode: "out_of_stock",
      problemMessage: 'Austin Woodworks can\'t send it: out of stock. They said: "Back in two weeks"',
    });
    expect((await f.orderRow(o.id)).fulfillmentStatus).toBe("problem");
    await expect(supplierMarkShipped(f.ctx, token, fid, { carrier: "UPS", trackingNumber: "1Z999" })).rejects.toThrow("can't send");

    // "Try again" sends the purchase order again.
    const before = f.poMails().length;
    await retryOrder(f.ctx, f.shop.id, o.id);
    expect(f.poMails()).toHaveLength(before + 1);
    expect((await f.orderRow(o.id)).fulfillmentStatus).toBe("sent_to_supplier");
  });

  it("orders that don't ship within a week get flagged late, and a refund tells the supplier not to send it", async () => {
    const f = await setup();
    const o = await f.order(f.products.lamp.id);
    f.advance(8 * DAY);
    expect(await syncTracking(f.ctx, { orderId: o.id })).toMatchObject({ late: 1 });
    expect((await f.orderRow(o.id)).fulfillmentStatus).toBe("problem");

    const result = await refundOrder(f.ctx, f.shop.id, o.id, { reason: "Too slow" });
    expect(result).toMatchObject({ cancelled: 1, notCancelled: [] });
    expect(f.poMails().at(-1)!.subject).toBe(`Cancelled: order PO-${o.number} from Glow Lamps`);
    const token = (await f.db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, f.maker.id) }))!.portalToken;
    expect((await supplierPortal(f.db, token))!.toSend).toHaveLength(0);
  });

  it("keeps sending other products to their API supplier", async () => {
    const f = await setup();
    await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, f.products.stand.id));
    const o = await f.order(f.products.lamp.id);
    const p = await f.order(f.products.stand.id);
    expect((await f.fulfillment(o.id)).supplierOrderRef).toBe(`PO-${o.number}`);
    expect((await f.fulfillment(p.id)).supplierOrderRef).not.toMatch(/^PO-/);
    expect(supplierLabel(f.ctx.suppliers, f.maker)).toBe("Austin Woodworks");
    expect(supplierLabel(f.ctx.suppliers, { provider: "fake", name: null })).toBe("Demo supplier");
  });

  it("manages suppliers: duplicate emails, renaming, resetting the link and removing", async () => {
    const f = await setup();
    await expect(addOwnSupplier(f.db, f.shop.id, { name: "Copy", email: "orders@austinwood.example" })).rejects.toThrow("already uses");
    await expect(addOwnSupplier(f.db, f.shop.id, { name: "", email: "x@example.com" })).rejects.toThrow("name");
    await expect(addOwnSupplier(f.db, f.shop.id, { name: "X", email: "nope" })).rejects.toThrow("email");
    const other = await addOwnSupplier(f.db, f.shop.id, { name: "Leeds Print", email: "hi@leeds.example" });
    await expect(updateOwnSupplier(f.db, f.shop.id, other.id, { name: "Leeds", email: "orders@austinwood.example" })).rejects.toThrow("Another supplier");
    expect((await updateOwnSupplier(f.db, f.shop.id, other.id, { name: "Leeds Print Co", email: "hi@leeds.example" })).name).toBe("Leeds Print Co");

    const o = await f.order(f.products.lamp.id);
    expect(await listOwnSuppliers(f.db, f.shop.id)).toMatchObject([
      { name: "Austin Woodworks", products: 1, openOrders: 1 },
      { name: "Leeds Print Co", products: 0, openOrders: 0 },
    ]);
    const oldToken = f.maker.portalToken;
    const reset = await resetSupplierLink(f.db, f.shop.id, f.maker.id);
    expect(reset.portalToken).not.toBe(oldToken);
    expect(await supplierPortal(f.db, oldToken)).toBeNull();

    await expect(removeOwnSupplier(f.db, f.shop.id, f.maker.id)).rejects.toThrow("still has 1 order");
    await supplierMarkShipped(f.ctx, reset.portalToken, (await f.fulfillment(o.id)).id, { carrier: "USPS", trackingNumber: "9400100000000000000000" });
    await removeOwnSupplier(f.db, f.shop.id, f.maker.id);
    expect(await supplierPortal(f.db, reset.portalToken)).toBeNull();
    const lamp = await f.db.query.products.findFirst({ where: eq(schema.products.id, f.products.lamp.id) });
    expect(lamp!.supplierId).toBeNull();
    // Adding them back reuses the row, so old orders keep their supplier.
    expect((await addOwnSupplier(f.db, f.shop.id, { name: "Austin Woodworks", email: "orders@austinwood.example" })).id).toBe(f.maker.id);
    // Another store's supplier can't be picked.
    const user = await signUp(f.db, { email: "other@example.com", password: "correct horse" });
    const otherShop = await createShop(f.db, user.id, { name: "Other", country: "US" });
    await expect(setProductSupplier(f.db, otherShop.id, f.products.lamp.id, f.maker.id)).rejects.toThrow("not found");
  });

  it("moving a product off an API supplier drops its supplier ids, and own suppliers survive export and import", async () => {
    const f = await setup();
    await setProductSupplier(f.db, f.shop.id, f.products.stand.id, f.maker.id);
    const stand = await f.db.query.products.findFirst({ where: eq(schema.products.id, f.products.stand.id) });
    expect(stand!.supplierProductRef).toBeNull();
    expect((await f.variants(f.products.stand.id)).every((v) => v.supplierVariantRef === null)).toBe(true);

    const file = await exportStore(f.db, f.shop.id);
    expect(file.products.find((p) => p.handle === stand!.handle)!.supplier).toMatchObject({ provider: "email", name: "Austin Woodworks", email: "orders@austinwood.example" });
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const fresh = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, fresh.id, JSON.parse(JSON.stringify(file)));
    expect(await listOwnSuppliers(f.db, fresh.id)).toMatchObject([{ name: "Austin Woodworks", products: 2 }]);
    const demo = await f.db.query.suppliers.findMany({ where: eq(schema.suppliers.shopId, fresh.id) });
    expect(demo.map((d) => d.provider).sort()).toEqual(["email", "fake"]);
  });
});
