import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, editOrder, getOrder, orderEditOptions } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const HOUR = 3_600_000;

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  const [small, large] = await f.variants(f.products.lamp.id);
  // Same price for both sizes, so a buyer can switch between them.
  await f.db.update(schema.variants).set({ priceMinor: small!.priceMinor }).where(eq(schema.variants.id, large!.id));
  return { f, shop, small: small!, large: large! };
}

describe("changing an order before it ships", () => {
  it("lets the merchant change the address and size, and places it with the supplier again", async () => {
    const { f, shop, large } = await setup();
    const order = await f.waitingOrder();
    const before = await getOrder(f.db, shop.id, order.id);
    expect(before.fulfillments.map((x) => x.status)).toEqual(["placed"]);

    const options = await orderEditOptions(f.ctx, shop.id, order.id, "merchant");
    expect(options.canEdit).toBe(true);
    expect(options.lines[0]!.choices.map((c) => c.title)).toEqual(["Small", "Large"]);

    f.advance(60_000);
    const line = before.lines[0]!;
    const result = await editOrder(f.ctx, shop.id, order.id, { address: { ...order.shippingAddress, line1: "9 Oak Ave" }, lines: { [line.id]: large.id } }, "merchant");
    expect(result.changes).toEqual(["New delivery address: 9 Oak Ave, Austin, 78701", "Sunset Projection Lamp – Small is now Sunset Projection Lamp – Large"]);

    const after = await getOrder(f.db, shop.id, order.id);
    expect(after.shippingAddress.line1).toBe("9 Oak Ave");
    expect(after.lines[0]).toMatchObject({ variantId: large.id, title: "Sunset Projection Lamp – Large", unitCostMinor: large.costMinor, unitPriceMinor: line.unitPriceMinor });
    // The old supplier order was cancelled and a new one placed.
    expect(after.fulfillments).toHaveLength(1);
    expect(after.fulfillments[0]!.status).toBe("placed");
    expect(after.fulfillments[0]!.supplierOrderRef).not.toBe(before.fulfillments[0]!.supplierOrderRef);
    expect(after.fulfillmentStatus).toBe("sent_to_supplier");
    expect(after.edits).toMatchObject([{ by: "merchant", changes: result.changes }]);
    const mail = f.mailer.sent.at(-1)!;
    expect(mail.subject).toBe(`Your order #${order.number} was updated`);
    expect(mail.text).toContain("Glow Lamps changed your order");
    expect(mail.text).toContain("9 Oak Ave");

    await expect(editOrder(f.ctx, shop.id, order.id, { address: after.shippingAddress }, "merchant")).rejects.toThrow("Nothing changed");
    await expect(editOrder(f.ctx, shop.id, order.id, { address: { ...after.shippingAddress, country: "CA", region: "ON", postalCode: "K1A 0B1" } }, "merchant")).rejects.toThrow("another address in United States");
  });

  it("gives buyers a few hours, and leaves the order alone when the supplier is already on it", async () => {
    const { f, shop } = await setup();
    const order = await f.waitingOrder();

    // A buyer's change is emailed back to them.
    await editOrder(f.ctx, shop.id, order.id, { address: { ...order.shippingAddress, line2: "Apt 4" } }, "buyer");
    expect(f.mailer.sent.at(-1)!.text).toContain("Here's the change you made");

    f.advance(13 * HOUR);
    expect(await orderEditOptions(f.ctx, shop.id, order.id, "buyer")).toMatchObject({ canEdit: false, reason: expect.stringContaining("12 hours") });
    await expect(editOrder(f.ctx, shop.id, order.id, { address: { ...order.shippingAddress, line1: "2 Elm St" } }, "buyer")).rejects.toThrow("12 hours");

    // A day on, the supplier has packed it: they won't cancel, so nothing changes.
    f.advance(DAY);
    const placed = (await getOrder(f.db, shop.id, order.id)).fulfillments[0]!;
    await expect(editOrder(f.ctx, shop.id, order.id, { address: { ...order.shippingAddress, line1: "2 Elm St" } }, "merchant")).rejects.toThrow("couldn't cancel");
    const still = await getOrder(f.db, shop.id, order.id);
    expect(still.shippingAddress.line1).toBe("1 Main St");
    expect(still.fulfillments[0]).toMatchObject({ status: "placed", supplierOrderRef: placed.supplierOrderRef });
    expect(still.edits).toHaveLength(1);
  });

  it("can't change a shipped order, or switch to a size at another price", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const shipped = await f.shippedOrder();
    expect((await orderEditOptions(f.ctx, shop.id, shipped.id, "merchant")).reason).toContain("already shipped");
    await expect(editOrder(f.ctx, shop.id, shipped.id, { address: { ...shipped.shippingAddress, line1: "x" } }, "merchant")).rejects.toThrow("already shipped");

    // Lamp sizes cost different amounts, so there's nothing to switch to.
    const order = await f.waitingOrder();
    const options = await orderEditOptions(f.ctx, shop.id, order.id, "merchant");
    expect(options.lines[0]!.choices).toEqual([]);
    const [, large] = await f.variants(f.products.lamp.id);
    await expect(editOrder(f.ctx, shop.id, order.id, { lines: { [options.lines[0]!.id]: large!.id } }, "merchant")).rejects.toThrow("same price");
  });
});
