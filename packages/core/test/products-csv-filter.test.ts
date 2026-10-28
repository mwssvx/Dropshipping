import { describe, expect, it } from "vitest";
import { createProduct, createShop, DemoModel, productsCsv, signUp } from "../src";
import { makeFixture } from "../evals/fixture";

describe("products spreadsheet", () => {
  it("can hold only the products the list shows", async () => {
    const f = await makeFixture(new DemoModel());
    const user = await signUp(f.db, { email: "csv-filter@example.com", password: "correct horse" });
    const shop = await createShop(f.db, user.id, { name: "Sheets", country: "US" });
    await createProduct(f.db, shop.id, { title: "Gone Mug", status: "active", tags: "kitchen", variants: [{ title: "Small", priceMinor: 1000, stock: 0, sku: "MUG-S" }, { title: "Large", priceMinor: 1200, stock: 0 }] });
    await createProduct(f.db, shop.id, { title: "Plenty Tee", status: "active", tags: "clothes", variants: [{ priceMinor: 2000, stock: 40 }] });
    await createProduct(f.db, shop.id, { title: "Draft Cap", status: "draft", tags: "clothes", variants: [{ priceMinor: 1500, stock: 2, sku: "CAP-1" }] });
    const titles = async (list?: Parameters<typeof productsCsv>[2]) =>
      (await productsCsv(f.db, shop.id, list)).trim().split("\n").slice(1).map((r) => r.split(",")[1]);
    expect(await titles()).toEqual(["Gone Mug", "Gone Mug", "Plenty Tee", "Draft Cap"]);
    // Every option of a matching product comes along, so the sheet can be uploaded back.
    expect(await titles({ stock: "sold_out" })).toEqual(["Gone Mug", "Gone Mug"]);
    expect(await titles({ tag: "Clothes" })).toEqual(["Plenty Tee", "Draft Cap"]);
    expect(await titles({ tag: "clothes", status: "draft" })).toEqual(["Draft Cap"]);
    expect(await titles({ stock: "low" })).toEqual(["Draft Cap"]);
    expect(await titles({ query: "cap-1" })).toEqual(["Draft Cap"]);
    expect(await titles({ query: "nothing" })).toEqual([]);
  });
});
