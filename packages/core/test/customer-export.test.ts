import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { customersCsv, DemoModel, updateCustomerNotes } from "../src";
import { makeFixture } from "../evals/fixture";

describe("customers as a spreadsheet", () => {
  it("has one row per customer, follows the list's search and tag, and leaves spend to those who see money", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await f.order(f.products.lamp.id, { name: "=HYPERLINK(1)" });
    const again = await f.order(f.products.lamp.id);
    // Two orders from the same buyer: the second buyer is the first one again.
    await f.db.update(schema.orders).set({ email: a.email }).where(eq(schema.orders.id, again.id));
    const b = await f.order(f.products.lamp.id);
    const customer = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, b.email) }))!;
    await updateCustomerNotes(f.db, shop.id, customer.id, { tags: "VIP" });
    await f.db.update(schema.customers).set({ name: "=HYPERLINK(1)" }).where(eq(schema.customers.email, a.email));

    const parse = (csv: string) => csv.trimEnd().split("\n").map((l) => l.split(","));
    const all = parse(await customersCsv(f.db, shop.id, { money: true }));
    expect(all[0]).toEqual(["Email", "Name", "City", "Country", "Orders", "Spent", "First order", "Last order", "Email marketing", "Account", "Tags", "Customer since"]);
    const rowA = all.find((r) => r[0] === a.email)!;
    // A name a spreadsheet would run as a formula is defused.
    expect(rowA.slice(1, 6)).toEqual(["'=HYPERLINK(1)", "Austin", "US", "2", ((a.totalMinor + again.totalMinor) / 100).toFixed(2)]);
    expect(rowA[6]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(all.find((r) => r[0] === b.email)!.slice(8, 11)).toEqual(["not subscribed", "no", "vip"]);

    const staff = parse(await customersCsv(f.db, shop.id, { money: false }));
    expect(staff[0]).not.toContain("Spent");
    expect(staff[1]).toHaveLength(11);

    expect(parse(await customersCsv(f.db, shop.id, { tag: "vip", money: true })).map((r) => r[0])).toEqual(["Email", b.email]);
    expect(parse(await customersCsv(f.db, shop.id, { query: a.email, money: true })).map((r) => r[0])).toEqual(["Email", a.email]);
  });
});
