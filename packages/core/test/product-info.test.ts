import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, PRODUCT_INFO_MAX, setProductInfo, UserError } from "../src";
import { makeFixture } from "../evals/fixture";

describe("notes under every product", () => {
  it("keeps filled rows in order and drops empty ones", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, shop.id) }))!.productInfo).toEqual([]);
    const saved = await setProductInfo(f.db, shop.id, [
      { title: " Shipping ", text: "Ships in 2 days.\r\nFree over $50. " },
      { title: "", text: "  " },
      { title: "Returns", text: "30 days, free." },
    ]);
    expect(saved).toEqual([{ title: "Shipping", text: "Ships in 2 days.\nFree over $50." }, { title: "Returns", text: "30 days, free." }]);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, shop.id) }))!.productInfo).toEqual(saved);
    expect(await setProductInfo(f.db, shop.id, [{ title: "", text: "" }])).toEqual([]);
  });

  it("asks for a title and text, and keeps them short", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await expect(setProductInfo(f.db, shop.id, [{ title: "", text: "Free returns" }])).rejects.toThrow("Give each note a title");
    await expect(setProductInfo(f.db, shop.id, [{ title: "Care", text: "" }])).rejects.toThrow("Write what “Care” should say.");
    await expect(setProductInfo(f.db, shop.id, [{ title: "x".repeat(61), text: "y" }])).rejects.toBeInstanceOf(UserError);
    await expect(setProductInfo(f.db, shop.id, [{ title: "Care", text: "y".repeat(1501) }])).rejects.toBeInstanceOf(UserError);
    const many = Array.from({ length: PRODUCT_INFO_MAX + 1 }, (_, i) => ({ title: `Note ${i}`, text: "Text" }));
    await expect(setProductInfo(f.db, shop.id, many)).rejects.toThrow(`Add up to ${PRODUCT_INFO_MAX} notes.`);
  });
});
