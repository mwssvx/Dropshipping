import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { buyerParam, countOrders, DemoModel, ordersCsv, orderPage, saveView } from "../src";
import { makeFixture } from "../evals/fixture";

describe("orders from new or returning buyers", () => {
  it("tells first orders from repeat ones by the buyer's email", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp } = f.products;
    const ada1 = await f.order(lamp.id);
    const bob = await f.order(lamp.id);
    const ada2 = await f.order(lamp.id);
    // Ada orders again with her email in capitals.
    await f.db.update(schema.orders).set({ email: ada1.email.toUpperCase() }).where(eq(schema.orders.id, ada2.id));

    const numbers = async (buyer?: string) => (await orderPage(f.db, shop.id, { buyer: buyerParam(buyer) })).orders.map((o) => o.number).sort();
    expect(await numbers("new")).toEqual([ada1.number, bob.number].sort());
    expect(await numbers("returning")).toEqual([ada2.number]);
    expect(await countOrders(f.db, shop.id, { buyer: "new" })).toBe(2);

    // An unpaid try before doesn't make Bob a returning buyer.
    await f.db.update(schema.orders).set({ paymentStatus: "pending", email: bob.email }).where(eq(schema.orders.id, ada1.id));
    expect(await numbers("returning")).toEqual([]);
    expect(buyerParam("old")).toBeUndefined();
    expect((await numbers("old")).length).toBe(3);

    const rows = (await ordersCsv(f.db, shop.id, { buyer: "new" })).split("\n").slice(1).filter(Boolean);
    expect(rows.length).toBe(3);
    expect((await saveView(f.db, shop.id, "orders", { name: "New buyers", params: { buyer: "new" } })).query).toBe("buyer=new");
  });
});
