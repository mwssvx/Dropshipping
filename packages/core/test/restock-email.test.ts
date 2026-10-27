import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { cancelRestockOrder, createProduct, createRestockOrder, DemoModel, emailRestockOrder, getRestockOrder, receiveRestock } from "../src";
import { makeFixture } from "../evals/fixture";

describe("emailing a restock order", () => {
  it("sends the supplier what's still wanted, with SKUs and costs, and replies come back to the merchant", async () => {
    const f = await makeFixture(new DemoModel());
    await f.db.update(schema.shops).set({ mailingAddress: "12 Market St\nAustin, TX 78701" }).where(eq(schema.shops.id, (await f.shop()).id));
    const shop = await f.shop();
    const mug = await createProduct(f.db, shop.id, { title: "Mug", status: "active", variants: [{ title: "Blue", priceMinor: 1500, stock: 0, sku: "MUG-B" }, { title: "Red", priceMinor: 1500, stock: 0 }] });
    const [blue, red] = await f.variants(mug.id);
    await expect(createRestockOrder(f.db, shop.id, { supplierName: "Clay & Co", supplierEmail: "not an email", lines: [{ variantId: blue!.id, quantity: 1 }] })).rejects.toThrow("supplier's email");
    const order = await createRestockOrder(f.db, shop.id, {
      supplierName: "Clay & Co",
      supplierEmail: " Orders@Clay.example ",
      expectedOn: "2026-11-20",
      note: "Our ref PO-77",
      lines: [{ variantId: blue!.id, quantity: 10, unitCostMinor: 400 }, { variantId: red!.id, quantity: 5 }],
    });
    expect(order.supplierEmail).toBe("orders@clay.example");
    const now = new Date("2026-11-01T10:00:00Z");
    expect(await emailRestockOrder(f.db, f.mailer, shop, order.id, { replyTo: "owner@example.com", now })).toEqual({ to: "orders@clay.example" });
    const mail = f.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "orders@clay.example", replyTo: "owner@example.com", subject: "Purchase order #1 from Glow Lamps" });
    expect(mail.text).toContain("- 10 x Mug (Blue) (SKU MUG-B) at $4.00 each = $40.00");
    expect(mail.text).toContain("- 5 x Mug (Red)\n");
    expect(mail.text).toContain("Total: $40.00 (for the lines with a price)");
    expect(mail.text).toContain("We'd like it by November 20, 2026.");
    expect(mail.text).toContain("12 Market St\nAustin, TX 78701");
    expect(mail.text).toContain("Our ref PO-77");
    expect((await getRestockOrder(f.db, shop.id, order.id)).emailedAt).toEqual(now);

    // Not twice in a row by accident; later, only what's still to come.
    await expect(emailRestockOrder(f.db, f.mailer, shop, order.id, { replyTo: "owner@example.com", now: new Date(now.getTime() + 60_000) })).rejects.toThrow("just sent");
    const [, redLine] = (await getRestockOrder(f.db, shop.id, order.id)).lines;
    const blueLine = (await getRestockOrder(f.db, shop.id, order.id)).lines[0]!;
    await receiveRestock(f.db, shop.id, order.id, [{ lineId: blueLine.id, quantity: 10 }, { lineId: redLine!.id, quantity: 2 }]);
    await emailRestockOrder(f.db, f.mailer, shop, order.id, { replyTo: "owner@example.com", now: new Date(now.getTime() + 3600_000) });
    expect(f.mailer.sent.at(-1)!.text).not.toContain("Blue");
    expect(f.mailer.sent.at(-1)!.text).toContain("- 3 x Mug (Red)");
  });

  it("needs an address, and an open order", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const mug = await createProduct(f.db, shop.id, { title: "Mug", status: "active", variants: [{ priceMinor: 1500, stock: 0 }] });
    const [v] = await f.variants(mug.id);
    const order = await createRestockOrder(f.db, shop.id, { supplierName: "Clay & Co", lines: [{ variantId: v!.id, quantity: 1 }] });
    await expect(emailRestockOrder(f.db, f.mailer, shop, order.id, { replyTo: "owner@example.com" })).rejects.toThrow("Add the supplier's email");
    await emailRestockOrder(f.db, f.mailer, shop, order.id, { to: "sales@clay.example", replyTo: "owner@example.com" });
    expect((await getRestockOrder(f.db, shop.id, order.id)).supplierEmail).toBe("sales@clay.example");
    await cancelRestockOrder(f.db, shop.id, order.id);
    await expect(emailRestockOrder(f.db, f.mailer, shop, order.id, { replyTo: "owner@example.com" })).rejects.toThrow("still on the way");
  });
});
