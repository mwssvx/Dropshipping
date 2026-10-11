import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, ordersCsv, updateOrderNotes } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

/** Splits the CSV into rows of cells (no quoted newlines in these fixtures). */
const parse = (csv: string) =>
  csv
    .trimEnd()
    .split("\n")
    .map((line) => [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1]!.replace(/^"|"$/g, "").replace(/""/g, '"')).slice(0, -1));

describe("orders as a spreadsheet", () => {
  it("has one row per item with the order on each, and follows the filters", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    expect(parse(await ordersCsv(f.db, shopId))).toHaveLength(1);

    const first = await f.order(f.products.lamp.id, { name: "=HYPERLINK(\"x\")", note: "Leave it, with the neighbour" });
    const second = await f.shippedOrder();
    await updateOrderNotes(f.db, shopId, second.id, { note: "VIP", tags: "vip" });

    const rows = parse(await ordersCsv(f.db, shopId));
    const header = rows[0]!;
    const col = (row: string[], name: string) => row[header.indexOf(name)];
    expect(rows).toHaveLength(3);
    // Oldest first.
    expect(rows.slice(1).map((r) => col(r, "Order"))).toEqual([String(first.number), String(second.number)]);
    const one = rows[1]!;
    // A name that looks like a formula is defused.
    expect(col(one, "Name")).toBe(`'=HYPERLINK("x")`);
    expect(col(one, "Buyer note")).toBe("Leave it, with the neighbour");
    expect(col(one, "Item")).toMatch(/^Sunset Projection Lamp/);
    expect(col(one, "Quantity")).toBe("1");
    expect(col(one, "Total")).toBe((first.totalMinor / 100).toFixed(2));
    expect(col(one, "Payment")).toBe("paid");
    const two = rows[2]!;
    expect(col(two, "Tracking")).not.toBe("");
    expect(col(two, "Tags")).toBe("vip");
    expect(col(two, "Your note")).toBe("VIP");

    // Same filters as the order list.
    expect(parse(await ordersCsv(f.db, shopId, { tag: "vip" })).slice(1).map((r) => col(r, "Order"))).toEqual([String(second.number)]);
    // A date range on when it was placed.
    await f.db.update(schema.orders).set({ createdAt: new Date(Date.now() - 10 * DAY) }).where(eq(schema.orders.id, first.id));
    const recent = await ordersCsv(f.db, shopId, { from: new Date(Date.now() - DAY) });
    expect(parse(recent).slice(1).map((r) => col(r, "Order"))).toEqual([String(second.number)]);
  });
});
