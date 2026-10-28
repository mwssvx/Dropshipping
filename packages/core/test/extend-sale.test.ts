import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { DemoModel, extendSale, salesFor } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("keeping a sale on longer", () => {
  it("moves the end by the days picked, while the sale hasn't ended", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const now = new Date();
    const [weekend, open, over] = await f.db
      .insert(schema.sales)
      .values([
        { shopId, title: "Black Friday weekend", percentOff: 25, scope: "all", startsAt: new Date(now.getTime() - DAY), endsAt: new Date(now.getTime() + DAY) },
        { shopId, title: "Always on", percentOff: 5, scope: "all", startsAt: new Date(now.getTime() - DAY), endsAt: null },
        { shopId, title: "Last week", percentOff: 10, scope: "all", startsAt: new Date(now.getTime() - 9 * DAY), endsAt: new Date(now.getTime() - 2 * DAY) },
      ])
      .returning();

    const later = new Date(now.getTime() + 2 * DAY);
    expect((await salesFor(f.db, shopId, [f.products.lamp.id], later)).get(f.products.lamp.id)?.title).toBe("Always on");
    const kept = await extendSale(f.db, shopId, weekend!.id, 3, now);
    expect(kept.endsAt).toEqual(new Date(weekend!.endsAt!.getTime() + 3 * DAY));
    // Cyber Monday too: still on two days from now.
    expect((await salesFor(f.db, shopId, [f.products.lamp.id], later)).get(f.products.lamp.id)?.title).toBe("Black Friday weekend");

    await expect(extendSale(f.db, shopId, weekend!.id, 5, now)).rejects.toThrow("how much longer");
    await expect(extendSale(f.db, shopId, open!.id, 1, now)).rejects.toThrow("until you end it");
    await expect(extendSale(f.db, shopId, over!.id, 1, now)).rejects.toThrow("has ended");
  });
});
