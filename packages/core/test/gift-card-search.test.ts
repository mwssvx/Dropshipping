import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, issueGiftCard, listGiftCards, setGiftCardDisabled, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

describe("finding a gift card", () => {
  it("finds a card by its code, last 4, email or order, filters by status and pages", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const gc = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" };
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await issueGiftCard(gc, shop, { email: `friend${i}@example.com`, amountMinor: 1000 * (i + 1) }));
    await setGiftCardDisabled(f.db, shop.id, made[0]!.card.id, true);
    await f.db.update(schema.giftCards).set({ balanceMinor: 0 }).where(eq(schema.giftCards.id, made[1]!.card.id));
    const [lamp] = await f.variants(f.products.lamp.id);
    const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: [{ variantId: lamp!.id, quantity: 1 }] });
    await f.db.update(schema.giftCards).set({ sourceOrderId: order!.id, sourceIndex: 0 }).where(eq(schema.giftCards.id, made[4]!.card.id));
    const ids = async (opts: Parameters<typeof listGiftCards>[2]) => (await listGiftCards(f.db, shop.id, opts)).cards.map((c) => c.id);

    const all = await listGiftCards(f.db, shop.id, { size: 2 });
    expect(all.total).toBe(5);
    expect(all.cards.map((c) => c.id)).toEqual([made[4]!.card.id, made[3]!.card.id]);
    expect(all.outstandingMinor).toBe(3000 + 4000 + 5000);
    expect(await ids({ size: 2, page: 3 })).toEqual([made[0]!.card.id]);

    // A buyer reads their code out, loosely typed.
    expect(await ids({ query: made[2]!.code.toLowerCase().replace(/-/g, " ") })).toEqual([made[2]!.card.id]);
    expect(await ids({ query: made[3]!.card.last4.toLowerCase() })).toContain(made[3]!.card.id);
    expect(await ids({ query: "FRIEND1@" })).toEqual([made[1]!.card.id]);
    expect(await ids({ query: `#${order!.number}` })).toEqual([made[4]!.card.id]);
    expect(await ids({ query: "nobody" })).toEqual([]);

    expect(await ids({ status: "off" })).toEqual([made[0]!.card.id]);
    expect(await ids({ status: "used" })).toEqual([made[1]!.card.id]);
    expect(await ids({ status: "active" })).toEqual([made[4]!.card.id, made[3]!.card.id, made[2]!.card.id]);
  });
});
