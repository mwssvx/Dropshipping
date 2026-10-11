import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, findRedirect, importShopifyProducts, parseCsv, readShopifyProducts } from "../src";
import { makeFixture } from "../evals/fixture";

const HEADER =
  "Handle,Title,Body (HTML),Vendor,Product Category,Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,Variant SKU,Variant Grams,Variant Inventory Tracker,Variant Inventory Qty,Variant Inventory Policy,Variant Fulfillment Service,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Taxable,Variant Barcode,Image Src,Image Position,Image Alt Text,Gift Card,SEO Title,SEO Description,Variant Image,Variant Weight Unit,Cost per item,Status";
const row = (cells: Record<string, string>) =>
  HEADER.split(",")
    .map((h) => {
      const v = cells[h] ?? "";
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    })
    .join(",");

// The shape Shopify exports: the first row has the product, the next rows add options and photos.
const FILE = [
  HEADER,
  row({
    Handle: "cloud-lamp", Title: "Cloud Lamp", "Body (HTML)": "<p>Soft light, \"cosy\" glow,\nfor any room.</p>", Published: "true",
    "Option1 Name": "Color", "Option1 Value": "White", "Option2 Name": "Size", "Option2 Value": "Small",
    "Variant SKU": "CL-W-S", "Variant Inventory Tracker": "shopify", "Variant Inventory Qty": "12", "Variant Price": "29.99",
    "Variant Compare At Price": "39.99", "Image Src": "https://cdn.shopify.com/cloud-1.jpg", "Image Position": "1", "Gift Card": "false",
    "SEO Title": "Cloud Lamp | Cosy night light", "SEO Description": "A soft cloud lamp.", "Cost per item": "8.50", Status: "active",
  }),
  row({ Handle: "cloud-lamp", "Option1 Value": "Pink", "Option2 Value": "Large", "Variant SKU": "CL-P-L", "Variant Inventory Tracker": "shopify", "Variant Inventory Qty": "0", "Variant Price": "1,034.00", "Variant Image": "https://cdn.shopify.com/cloud-pink.jpg", "Image Src": "https://cdn.shopify.com/cloud-2.jpg", "Image Position": "2" }),
  row({ Handle: "cloud-lamp", "Image Src": "https://cdn.shopify.com/cloud-3.jpg", "Image Position": "3" }),
  row({ Handle: "plain-mug", Title: "Plain Mug", "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant Price": "12", Status: "draft" }),
  row({ Handle: "gift-card", Title: "Gift Card", "Option1 Name": "Denominations", "Option1 Value": "$25", "Variant Price": "25.00", "Gift Card": "true", Status: "active" }),
  row({ Handle: "broken", Title: "Broken", "Variant Price": "free", Status: "active" }),
].join("\r\n");

describe("moving from Shopify", () => {
  it("reads quoted fields, doubled quotes and line breaks", () => {
    expect(parseCsv('a,"b ""c""",d\r\n"x\ny",,z\n')).toEqual([["a", 'b "c"', "d"], ["x\ny", "", "z"]]);
    expect(parseCsv("﻿Handle,Title\n\n")).toEqual([["Handle", "Title"]]);
  });

  it("turns a products file into products with their options and photos", () => {
    const { products, problems } = readShopifyProducts(FILE);
    expect(products.map((p) => p.handle)).toEqual(["cloud-lamp", "plain-mug"]);
    const lamp = products[0]!;
    expect(lamp).toMatchObject({
      title: "Cloud Lamp",
      descriptionHtml: '<p>Soft light, "cosy" glow,\nfor any room.</p>',
      status: "active",
      seoTitle: "Cloud Lamp | Cosy night light",
      images: ["https://cdn.shopify.com/cloud-1.jpg", "https://cdn.shopify.com/cloud-2.jpg", "https://cdn.shopify.com/cloud-3.jpg"],
    });
    expect(lamp.variants).toEqual([
      { title: "White / Small", options: { Color: "White", Size: "Small" }, sku: "CL-W-S", priceMinor: 2999, compareAtMinor: 3999, costMinor: 850, stock: 12, imageUrl: null },
      { title: "Pink / Large", options: { Color: "Pink", Size: "Large" }, sku: "CL-P-L", priceMinor: 103400, compareAtMinor: null, costMinor: null, stock: 0, imageUrl: "https://cdn.shopify.com/cloud-pink.jpg" },
    ]);
    // No options in Shopify is one option here, and untracked stock is unlimited.
    expect(products[1]!.variants).toEqual([{ title: "Default", options: {}, sku: null, priceMinor: 1200, compareAtMinor: null, costMinor: null, stock: null, imageUrl: null }]);
    expect(problems).toEqual([
      'Row 7: "free" isn\'t a price, so that option of Broken was left out.',
      "Gift Card is a gift card. Make gift cards under Gift cards instead.",
      "Broken has no price, so it was left out.",
    ]);
    expect(() => readShopifyProducts("Name,Price\nLamp,10")).toThrow("isn't a Shopify products file");
  });

  it("adds them as drafts, keeps their web addresses, and skips ones already there", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const long = "a-very-long-shopify-handle-that-goes-on-and-on-past-sixty-characters-easily";
    const file = `${FILE}\n${row({ Handle: long, Title: "Long One", "Variant Price": "5", Status: "active" })}`;
    const result = await importShopifyProducts(f.db, shopId, file);
    expect(result).toMatchObject({ created: 3, skipped: [] });
    const lamp = await f.db.query.products.findFirst({ where: eq(schema.products.handle, "cloud-lamp") });
    expect(lamp).toMatchObject({ status: "draft", imageUrl: "https://cdn.shopify.com/cloud-1.jpg", seoDescription: "A soft cloud lamp." });
    const variants = await f.db.query.variants.findMany({ where: eq(schema.variants.productId, lamp!.id), orderBy: asc(schema.variants.position) });
    expect(variants.map((v) => [v.title, v.priceMinor, v.stock])).toEqual([["White / Small", 2999, 12], ["Pink / Large", 103400, 0]]);
    // The shortened handle sends its old address on.
    const shortened = await f.db.query.products.findFirst({ where: eq(schema.products.title, "Long One") });
    expect(shortened!.handle.length).toBeLessThanOrEqual(60);
    expect(await findRedirect(f.db, shopId, `/products/${long}`)).toBe(`/products/${shortened!.handle}`);

    // The same file again adds nothing; keeping the status puts active ones on sale.
    expect(await importShopifyProducts(f.db, shopId, FILE, { keepStatus: true })).toMatchObject({ created: 0, skipped: ["Cloud Lamp", "Plain Mug"] });
    const g = await makeFixture(new DemoModel());
    await importShopifyProducts(g.db, (await g.shop()).id, FILE, { keepStatus: true });
    expect((await g.db.query.products.findFirst({ where: eq(schema.products.handle, "cloud-lamp") }))!.status).toBe("active");
    expect((await g.db.query.products.findFirst({ where: eq(schema.products.handle, "plain-mug") }))!.status).toBe("draft");
  });
});
