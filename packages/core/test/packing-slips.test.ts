import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, exportStore, packingSlips, setPackingSlipNote } from "../src";
import { makeFixture } from "../evals/fixture";

describe("packing slips", () => {
  it("lists who it's for and what's in the box, with no prices, for one order or all those waiting", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const first = await f.waitingOrder();
    const gift = await f.waitingOrder();
    await f.db.update(schema.orders).set({ gift: { from: "Grace", message: "Happy birthday!", recipientEmail: null }, buyerNote: "Leave by the door" }).where(eq(schema.orders.id, gift.id));
    const shipped = await f.shippedOrder();
    const [v] = await f.variants(f.products.lamp.id);
    await f.db.update(schema.variants).set({ sku: "LAMP-S" }).where(eq(schema.variants.id, v!.id));

    await expect(setPackingSlipNote(f.db, shop.id, "x".repeat(501))).rejects.toThrow("under 500 characters");
    expect(await setPackingSlipNote(f.db, shop.id, "  Thanks! Use THANKS10 for 10% off next time.\r\n ")).toBe("Thanks! Use THANKS10 for 10% off next time.");

    const one = await packingSlips(f.db, shop.id, { orderId: shipped.id });
    expect(one.store).toMatchObject({ name: "Glow Lamps", note: "Thanks! Use THANKS10 for 10% off next time." });
    expect(one.slips).toHaveLength(1);
    expect(one.slips[0]).toMatchObject({ number: shipped.number, shipTo: { name: "Ada Lovelace", postalCode: "78701" }, gift: null });
    expect(one.slips[0]!.items).toEqual([{ title: "Sunset Projection Lamp – Small", sku: "LAMP-S", quantity: 1, personalization: null, preorder: false }]);
    expect(JSON.stringify(one)).not.toMatch(/price|Minor/i);

    const waiting = await packingSlips(f.db, shop.id, "waiting");
    expect(waiting.slips.map((s) => s.number)).toEqual([first.number, gift.number]);
    expect(waiting.slips[1]).toMatchObject({ gift: { from: "Grace", message: "Happy birthday!" }, buyerNote: "Leave by the door" });

    await expect(packingSlips(f.db, shop.id, { orderId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow("Order");
    expect((await exportStore(f.db, shop.id)).store.packing_slip_note).toBe("Thanks! Use THANKS10 for 10% off next time.");
    expect(await setPackingSlipNote(f.db, shop.id, "")).toBeNull();
  });
});
