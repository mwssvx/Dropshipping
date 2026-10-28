import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, exportCustomerData, saveItem, sharedSaved, shareSaved, stopSharingSaved } from "../src";
import { makeFixture } from "../evals/fixture";

describe("sharing a saved list", () => {
  it("gives a link a friend can open, with no email or saved prices, until it's turned off", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, projector } = f.products;
    const [ada] = await f.db.insert(schema.customers).values({ shopId: shop.id, email: "ada@example.com", name: "Ada Lovelace" }).returning();
    await saveItem(f.db, shop.id, ada!.id, lamp.id);
    await saveItem(f.db, shop.id, ada!.id, projector.id);

    const token = await shareSaved(f.db, shop.id, ada!.id);
    expect(token).toMatch(/^[\w-]{24}$/);
    expect(await shareSaved(f.db, shop.id, ada!.id)).toBe(token); // pressing again keeps the link

    const list = await sharedSaved(f.db, shop.id, token);
    expect(list?.firstName).toBe("Ada");
    expect(list?.items.map((i) => i.id).sort()).toEqual([lamp.id, projector.id].sort());
    expect(list?.items[0]).not.toHaveProperty("savedPriceMinor");
    expect(JSON.stringify(list)).not.toContain("ada@example.com");

    // The link only works on its own store, and a made-up token finds nothing.
    const otherShop = "00000000-0000-0000-0000-000000000000";
    expect(await sharedSaved(f.db, otherShop, token)).toBeNull();
    expect(await sharedSaved(f.db, shop.id, "x".repeat(24))).toBeNull();
    expect(await sharedSaved(f.db, shop.id, "' or 1=1 --")).toBeNull();
    expect((await exportCustomerData(f.db, shop, ada!.id))?.saved_list_shared).toBe(true);

    // Archived products drop off the shared list too.
    await f.db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.id, projector.id));
    expect((await sharedSaved(f.db, shop.id, token))?.items.map((i) => i.id)).toEqual([lamp.id]);

    // Turning sharing off breaks the old link; sharing again makes a new one.
    await stopSharingSaved(f.db, shop.id, ada!.id);
    expect(await sharedSaved(f.db, shop.id, token)).toBeNull();
    const again = await shareSaved(f.db, shop.id, ada!.id);
    expect(again).not.toBe(token);
    expect((await sharedSaved(f.db, shop.id, again))?.items).toHaveLength(1);

    // A buyer with no name is shown without one.
    const [bo] = await f.db.insert(schema.customers).values({ shopId: shop.id, email: "bo@example.com" }).returning();
    expect((await sharedSaved(f.db, shop.id, await shareSaved(f.db, shop.id, bo!.id)))).toEqual({ firstName: null, items: [] });
    await expect(shareSaved(f.db, otherShop, bo!.id)).rejects.toThrow("not found");
  });
});
