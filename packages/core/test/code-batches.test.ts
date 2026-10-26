import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { codeBatchCsv, createCodeBatch, DemoModel, exportStore, handlePaymentEvent, listCodeBatches, listDiscounts, setCodeBatchActive, startCheckout } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("one-time codes", () => {
  it("makes many codes with one offer, each good for one paid order by anyone", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await expect(createCodeBatch(f.db, shop.id, { name: "Cards", prefix: "x", count: 10, kind: "percent", value: 10 })).rejects.toThrow("2 to 12 letters or numbers");
    await expect(createCodeBatch(f.db, shop.id, { name: "Cards", prefix: "THANKS", count: 1001, kind: "percent", value: 10 })).rejects.toThrow("Make 1 to 1000 codes.");
    await expect(createCodeBatch(f.db, shop.id, { name: "Cards", prefix: "THANKS", count: 5, kind: "percent", value: 0 })).rejects.toThrow("between 1 and 100");
    await expect(createCodeBatch(f.db, shop.id, { name: "Cards", prefix: "THANKS", count: 5, kind: "amount", value: 500, endsAt: new Date(Date.now() - DAY) })).rejects.toThrow("in the future");

    const batch = await createCodeBatch(f.db, shop.id, { name: "Parcel cards", prefix: "thanks", count: 300, kind: "amount", value: 500 });
    const codes = await f.db.query.discounts.findMany({ where: eq(schema.discounts.batchId, batch.id) });
    expect(codes).toHaveLength(300);
    expect(new Set(codes.map((c) => c.code)).size).toBe(300);
    expect(codes.every((c) => /^THANKS-[A-HJ-NP-Z2-9]{8}$/.test(c.code) && c.usageLimit === 1 && c.source === "batch" && c.email === null)).toBe(true);
    // Not mixed into the codes list or the store export.
    expect(await listDiscounts(f.db, shop.id)).toEqual([]);
    expect((await exportStore(f.db, shop.id)).discount_codes).toEqual([]);

    const [lamp] = await f.variants(f.products.lamp.id);
    const code = codes[0]!.code;
    const checkout = (email: string, discountCode = code) => startCheckout(f.db, f.payments, shop, { email, address, lines: [{ variantId: lamp!.id, quantity: 1 }], discountCode });
    const { order } = await checkout("ada@example.com");
    expect(order.discountMinor).toBe(500);
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    // Used once, by anyone: it's gone for everyone; the other codes still work.
    await expect(checkout("grace@example.com")).rejects.toThrow("has been used up");
    expect((await checkout("grace@example.com", codes[1]!.code)).order.discountMinor).toBe(500);

    expect(await listCodeBatches(f.db, shop.id)).toMatchObject([{ id: batch.id, name: "Parcel cards", prefix: "THANKS", count: 300, kind: "amount", value: 500, used: 1, active: true }]);
    const { csv } = await codeBatchCsv(f.db, shop.id, batch.id);
    const rows = csv.trimEnd().split("\n").map((l) => l.split(","));
    expect(rows[0]).toEqual(["Code", "Used", "Order", "Used on"]);
    expect(rows).toHaveLength(301);
    expect(rows.find((r) => r[0] === code)).toEqual([code, "yes", `#${order.number}`, new Date().toISOString().slice(0, 10)]);
    expect(rows.find((r) => r[0] === codes[1]!.code)).toEqual([codes[1]!.code, "no", "", ""]);

    // Turning the batch off stops every code; turning it on brings back the unused ones.
    await setCodeBatchActive(f.db, shop.id, batch.id, false);
    await expect(checkout("lin@example.com", codes[2]!.code)).rejects.toThrow("isn't a valid code");
    await setCodeBatchActive(f.db, shop.id, batch.id, true);
    expect((await checkout("lin@example.com", codes[2]!.code)).order.discountMinor).toBe(500);
  });

  it("keeps each store's batches to itself", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const batch = await createCodeBatch(f.db, shop.id, { name: "Event", prefix: "FAIR", count: 3, kind: "free_shipping" });
    const other = (await f.db.insert(schema.shops).values({ name: "Other", handle: "other-shop", country: "US" }).returning())[0]!;
    await expect(codeBatchCsv(f.db, other.id, batch.id)).rejects.toThrow();
    await expect(setCodeBatchActive(f.db, other.id, batch.id, false)).rejects.toThrow();
    expect(await listCodeBatches(f.db, other.id)).toEqual([]);
    expect((await listCodeBatches(f.db, shop.id))[0]).toMatchObject({ kind: "free_shipping", value: 0, used: 0 });
  });
});
