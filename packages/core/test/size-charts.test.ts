import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  convertSizeCell, createCollection, createShop, createSizeChart, deleteSizeChart, DemoModel, draftSizeChartWithAi, exportStore, importStore, listSizeCharts,
  signUp, sizeChartForProduct, sizeChartRows, updateSizeChart,
} from "../src";
import { makeFixture } from "../evals/fixture";

const TEE = { name: "T-shirts", unit: "cm" as const, columns: ["Size", "Chest", "Length"], rows: [["S", "86-91", "69"], ["M", "96-101", "72"]], note: "Measured flat." };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  return { ...f, shopRow: shop, shopId: shop.id, lamp: f.products.lamp.id, stand: f.products.stand.id, projector: f.products.projector.id };
}

describe("size charts", () => {
  it("checks the table the merchant makes", async () => {
    const f = await setup();
    const make = (x: Partial<typeof TEE> & { productIds?: string[] }) => createSizeChart(f.db, f.shopId, { ...TEE, ...x });
    await expect(make({ name: " " })).rejects.toThrow("Give the chart a name");
    await expect(make({ columns: ["Size"] })).rejects.toThrow("at least one measurement column");
    await expect(make({ rows: [["S", "86"]] })).rejects.toThrow("a cell for each column");
    await expect(make({ rows: [["", "86", "69"]] })).rejects.toThrow("size name");
    await expect(make({ rows: [["S", "1", "2"], ["s", "3", "4"]] })).rejects.toThrow("only be in the chart once");
    await expect(make({ productIds: ["00000000-0000-4000-8000-000000000000"] })).rejects.toThrow("Pick products from your store");
    const c = await make({ note: "" });
    expect(c).toMatchObject({ name: "T-shirts", note: null, published: true, productIds: [] });
    await updateSizeChart(f.db, f.shopId, c.id, { ...TEE, name: "Tees" });
    expect((await listSizeCharts(f.db, f.shopId)).map((x) => x.name)).toEqual(["Tees"]);
    await deleteSizeChart(f.db, f.shopId, c.id);
    await expect(deleteSizeChart(f.db, f.shopId, c.id)).rejects.toThrow("not found");
  });

  it("shows a product's own chart before its collection's, and only published ones", async () => {
    const f = await setup();
    const col = await createCollection(f.db, f.shopId, { title: "Desk", productIds: [f.lamp, f.stand] });
    const general = await createSizeChart(f.db, f.shopId, { ...TEE, name: "Desk things", collectionIds: [col.id] });
    const own = await createSizeChart(f.db, f.shopId, { ...TEE, name: "Lamp", productIds: [f.lamp] });
    expect((await sizeChartForProduct(f.db, f.shopId, f.lamp))?.id).toBe(own.id);
    expect((await sizeChartForProduct(f.db, f.shopId, f.stand))?.id).toBe(general.id);
    expect(await sizeChartForProduct(f.db, f.shopId, f.projector)).toBeNull();
    await updateSizeChart(f.db, f.shopId, own.id, { ...TEE, productIds: [f.lamp], published: false });
    expect((await sizeChartForProduct(f.db, f.shopId, f.lamp))?.id).toBe(general.id);
  });

  it("converts measurements between centimetres and inches, but not the size names", () => {
    // Inches to the nearest quarter, centimetres to the nearest whole number.
    expect(convertSizeCell("86-91", "cm", "in")).toBe("33.75-35.75");
    expect(convertSizeCell("72", "cm", "in")).toBe("28.25");
    expect(convertSizeCell("34", "in", "cm")).toBe("86");
    expect(convertSizeCell("Regular", "cm", "in")).toBe("Regular");
    expect(sizeChartRows({ unit: "cm", rows: [["32", "81", "107.5"]] }, "in")).toEqual([["32", "32", "42.25"]]);
    expect(sizeChartRows({ unit: "cm", rows: [["S", "81"]] }, "cm")).toEqual([["S", "81"]]);
  });

  it("drafts a hidden chart from the supplier's description, without inventing measurements", async () => {
    const f = await setup();
    await f.db
      .update(schema.products)
      .set({ descriptionHtml: "<p>Soft cotton tee.</p><ul><li>S: Bust 86cm Length 62cm</li><li>M: Bust 91cm Length 64cm</li><li>L: Bust 96cm Length 66cm</li></ul>" })
      .where(eq(schema.products.id, f.lamp));
    const run = await draftSizeChartWithAi(f.ctx, f.shopRow, f.lamp);
    expect(run.status).toBe("done");
    const chart = (await listSizeCharts(f.db, f.shopId)).find((c) => c.id === run.chartId)!;
    expect(chart).toMatchObject({ unit: "cm", published: false, productIds: [f.lamp], columns: ["Size", "Chest", "Length"], rows: [["S", "86", "62"], ["M", "91", "64"], ["L", "96", "66"]] });
    // Hidden until the merchant checks it.
    expect(await sizeChartForProduct(f.db, f.shopId, f.lamp)).toBeNull();

    // No measurements in the description: the sizes with empty cells, and a note to check.
    const empty = await draftSizeChartWithAi(f.ctx, f.shopRow, f.stand);
    const draft = (await listSizeCharts(f.db, f.shopId)).find((c) => c.id === empty.chartId)!;
    expect(draft.note).toMatch(/^\[Check: /);
    expect(draft.rows.every((r) => r.slice(1).every((c) => c === ""))).toBe(true);
    await expect(draftSizeChartWithAi(f.ctx, f.shopRow, "nope")).rejects.toThrow("not found");
  });

  it("travels with the store file", async () => {
    const f = await setup();
    const col = await createCollection(f.db, f.shopId, { title: "Desk", productIds: [f.lamp] });
    await createSizeChart(f.db, f.shopId, { ...TEE, productIds: [f.stand], collectionIds: [col.id], published: false });
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, f.shopId)));
    const stand = (await f.db.query.products.findFirst({ where: eq(schema.products.id, f.stand) }))!;
    expect(file.size_charts).toEqual([{ ...TEE, products: [stand.handle], collections: [col.handle], published: false }]);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    expect((await importStore(f.db, copy.id, file)).sizeCharts).toBe(1);
    const [chart] = await listSizeCharts(f.db, copy.id);
    expect(chart).toMatchObject({ name: "T-shirts", published: false, rows: TEE.rows });
    expect(chart!.productIds).toHaveLength(1);
    expect(chart!.collectionIds).toHaveLength(1);
  });
});
