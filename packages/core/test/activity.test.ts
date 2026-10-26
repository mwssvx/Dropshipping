import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createShop, DemoModel, listActivity, logActivity, pruneActivity, signUp } from "../src";
import { makeFixture } from "../evals/fixture";

describe("team activity log", () => {
  it("notes who did what, newest first, with order numbers and links", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const owner = await f.db.query.users.findFirst({ where: eq(schema.users.email, "owner@example.com") });
    const sam = await signUp(f.db, { email: "sam@example.com", password: "correct horse" });
    const order = await f.order(f.products.lamp.id);
    const at = (m: number) => new Date(Date.UTC(2026, 9, 11, 12, m));

    await logActivity(f.db, { shopId: shop.id, userId: owner!.id, email: owner!.email }, "Refunded $5.00 on order {order}", { orderId: order.id }, at(0));
    await logActivity(f.db, { shopId: shop.id, userId: sam.id, email: sam.email }, "Edited the product “Lamp”", { href: "/admin/products/x" }, at(1));
    // Another store's entries never show.
    const other = await createShop(f.db, sam.id, { name: "Sam's Socks", country: "US" });
    await logActivity(f.db, { shopId: other.id, userId: sam.id, email: sam.email }, "Elsewhere", {}, at(1));

    const { entries, next } = await listActivity(f.db, shop.id);
    expect(entries.map((e) => [e.email, e.summary, e.href])).toEqual([
      ["sam@example.com", "Edited the product “Lamp”", "/admin/products/x"],
      ["owner@example.com", `Refunded $5.00 on order #${order.number}`, `/admin/orders/${order.id}`],
    ]);
    expect(next).toBeNull();
    expect((await listActivity(f.db, shop.id, { userId: sam.id })).entries).toHaveLength(1);
    // An order this store doesn't have isn't named.
    await logActivity(f.db, { shopId: other.id, userId: sam.id, email: sam.email }, "Looked at order {order}", { orderId: order.id }, at(2));
    expect((await listActivity(f.db, other.id)).entries[0]!.summary).toBe("Looked at order an order");
    await logActivity(f.db, { shopId: shop.id, userId: sam.id, email: sam.email }, "Looked at order {order}", { orderId: crypto.randomUUID() }, at(2));
    expect((await listActivity(f.db, shop.id)).entries[0]!.summary).toBe("Looked at order an order");
  });

  it("pages through older entries, keeps entries when someone's account goes, and forgets after about a year", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const temp = await signUp(f.db, { email: "temp@example.com", password: "correct horse" });
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 60; i++) await logActivity(f.db, { shopId: shop.id, userId: temp.id, email: temp.email }, `Step ${i}`, {}, new Date(start + i * 60_000));
    const first = await listActivity(f.db, shop.id);
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0]!.summary).toBe("Step 59");
    const second = await listActivity(f.db, shop.id, { before: first.next! });
    expect(second.entries.map((e) => e.summary)).toEqual(Array.from({ length: 10 }, (_, i) => `Step ${9 - i}`));
    expect(second.next).toBeNull();

    await f.db.delete(schema.users).where(eq(schema.users.id, temp.id));
    expect((await listActivity(f.db, shop.id)).entries[0]).toMatchObject({ userId: null, email: "temp@example.com" });

    await pruneActivity(f.db, new Date(start + 399 * 86_400_000));
    expect((await listActivity(f.db, shop.id)).entries).toHaveLength(50);
    await pruneActivity(f.db, new Date(start + 401 * 86_400_000));
    expect((await listActivity(f.db, shop.id)).entries).toHaveLength(0);
  });
});
