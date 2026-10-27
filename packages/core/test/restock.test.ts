import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { cancelRestockOrder, createProduct, createRestockOrder, DemoModel, getRestockOrder, incomingStock, listRestockOrders, receiveRestock, restockChoices, stockHistory } from "../src";
import { makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const mug = await createProduct(f.db, shopId, {
    title: "Mug",
    status: "active",
    variants: [
      { title: "Blue", priceMinor: 1500, stock: 2, costMinor: 400 },
      { title: "Green", priceMinor: 1500 },
    ],
  });
  const [blue, green] = await f.variants(mug.id);
  const variant = async (id: string) => (await f.db.query.variants.findFirst({ where: eq(schema.variants.id, id) }))!;
  return { ...f, shopId, mug, blue: blue!, green: green!, variant };
}

describe("restock orders", () => {
  it("adds what arrives to the stock, a part at a time, with the cost paid and a line in the history", async () => {
    const f = await setup();
    const choices = await restockChoices(f.db, f.shopId);
    expect(choices.map((c) => c.title)).toEqual(["Mug (Blue)", "Mug (Green)"]);

    const order = await createRestockOrder(f.db, f.shopId, {
      supplierName: " Clay & Co ",
      expectedOn: "2026-11-02",
      lines: [
        { variantId: f.blue.id, quantity: 10, unitCostMinor: 350 },
        { variantId: f.green.id, quantity: 4 },
      ],
    });
    expect(order).toMatchObject({ number: 1, supplierName: "Clay & Co", status: "open" });
    expect((await createRestockOrder(f.db, f.shopId, { supplierName: "Clay & Co", lines: [{ variantId: f.blue.id, quantity: 1 }] })).number).toBe(2);

    const incoming = await incomingStock(f.db, f.shopId, f.mug.id);
    expect(incoming.map((i) => [i.variantId, i.quantity, i.restock.number])).toEqual([
      [f.blue.id, 10, 1],
      [f.green.id, 4, 1],
      [f.blue.id, 1, 2],
    ]);

    // Six blue mugs came first.
    const full = await getRestockOrder(f.db, f.shopId, order.id);
    expect(full).toMatchObject({ ordered: 14, received: 0, costMinor: 3500 });
    const blueLine = full.lines.find((l) => l.variantId === f.blue.id)!;
    expect(await receiveRestock(f.db, f.shopId, order.id, [{ lineId: blueLine.id, quantity: 6 }])).toEqual({ added: 6, done: false });
    expect(await f.variant(f.blue.id)).toMatchObject({ stock: 8, costMinor: 350 });

    // Then the rest; more than ordered is capped, and Green starts being counted.
    const rest = full.lines.map((l) => ({ lineId: l.id, quantity: 99 }));
    expect(await receiveRestock(f.db, f.shopId, order.id, rest)).toEqual({ added: 8, done: true });
    expect((await f.variant(f.blue.id)).stock).toBe(12);
    expect((await f.variant(f.green.id)).stock).toBe(4);
    expect((await getRestockOrder(f.db, f.shopId, order.id)).status).toBe("received");
    await expect(receiveRestock(f.db, f.shopId, order.id)).rejects.toThrow("already arrived");

    const history = await stockHistory(f.db, f.shopId, f.mug.id);
    expect(history.slice(0, 3).map((h) => [h.option, h.reason, h.change, h.stockAfter, h.restock?.number])).toEqual([
      ["Green", "received", 4, 4, 1],
      ["Blue", "received", 4, 12, 1],
      ["Blue", "received", 6, 8, 1],
    ]);
    expect((await incomingStock(f.db, f.shopId, f.mug.id)).map((i) => i.restock.number)).toEqual([2]);
  });

  it("can be cancelled, keeping what already came, and lists open ones first", async () => {
    const f = await setup();
    const first = await createRestockOrder(f.db, f.shopId, { supplierName: "A", lines: [{ variantId: f.blue.id, quantity: 5 }] });
    const second = await createRestockOrder(f.db, f.shopId, { supplierName: "B", lines: [{ variantId: f.blue.id, quantity: 3 }] });
    const line = (await getRestockOrder(f.db, f.shopId, first.id)).lines[0]!;
    await receiveRestock(f.db, f.shopId, first.id, [{ lineId: line.id, quantity: 2 }]);
    await cancelRestockOrder(f.db, f.shopId, first.id);
    expect((await f.variant(f.blue.id)).stock).toBe(4);
    await expect(receiveRestock(f.db, f.shopId, first.id)).rejects.toThrow("cancelled");
    await expect(cancelRestockOrder(f.db, f.shopId, first.id)).rejects.toThrow("still on the way");
    expect((await listRestockOrders(f.db, f.shopId)).map((o) => [o.number, o.status, o.received])).toEqual([
      [second.number, "open", 0],
      [first.number, "cancelled", 2],
    ]);
  });

  it("checks what's ordered", async () => {
    const f = await setup();
    const line = [{ variantId: f.blue.id, quantity: 1 }];
    await expect(createRestockOrder(f.db, f.shopId, { supplierName: " ", lines: line })).rejects.toThrow("who you're ordering from");
    await expect(createRestockOrder(f.db, f.shopId, { supplierName: "A", lines: [] })).rejects.toThrow("at least one option");
    await expect(createRestockOrder(f.db, f.shopId, { supplierName: "A", lines: [{ variantId: f.blue.id, quantity: 1.5 }] })).rejects.toThrow("whole numbers");
    await expect(createRestockOrder(f.db, f.shopId, { supplierName: "A", expectedOn: "next week", lines: line })).rejects.toThrow("date it should arrive");
    // Supplier products restock themselves.
    const [lamp] = await f.variants(f.products.lamp.id);
    await expect(createRestockOrder(f.db, f.shopId, { supplierName: "A", lines: [{ variantId: lamp!.id, quantity: 3 }] })).rejects.toThrow("stock you keep yourself");
    await expect(getRestockOrder(f.db, f.shopId, "nope")).rejects.toThrow("not found");
    const order = await createRestockOrder(f.db, f.shopId, { supplierName: "A", lines: line });
    await expect(receiveRestock(f.db, f.shopId, order.id, [])).rejects.toThrow("how many of something arrived");
  });
});
