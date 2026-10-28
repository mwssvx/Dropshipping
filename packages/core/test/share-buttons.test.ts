import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, setShareButtons } from "../src";
import { makeFixture } from "../evals/fixture";

describe("share buttons on product pages", () => {
  it("are on by default and the merchant can turn them off", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const read = async () => (await f.db.query.shops.findFirst({ where: eq(schema.shops.id, shop.id) }))!.shareButtons;
    expect(await read()).toBe(true);
    expect(await setShareButtons(f.db, shop.id, false)).toBe(false);
    expect(await read()).toBe(false);
    await setShareButtons(f.db, shop.id, true);
    expect(await read()).toBe(true);
  });
});
