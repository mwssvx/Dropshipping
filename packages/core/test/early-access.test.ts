import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, deleteSale, earlyAccessEmail, endEarlyAccess, giveEarlyAccess, listSales, quoteCart } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("early access to a sale", () => {
  it("gives a code with the sale's percentage until the sale starts, then everyone has the price", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const now = new Date();
    const [small] = await f.variants(f.products.lamp.id);
    const [galaxy] = await f.variants(f.products.projector.id);
    const [sale] = await f.db
      .insert(schema.sales)
      .values({ shopId, title: "Black Friday!", percentOff: 30, scope: "products", productIds: [f.products.lamp.id], startsAt: new Date(now.getTime() + 2 * DAY), endsAt: null })
      .returning();

    const code = await giveEarlyAccess(f.db, shopId, sale!.id, {}, now);
    expect(code).toMatchObject({ code: "EARLY-BLACKFRIDAY", kind: "percent", value: 30, productIds: [f.products.lamp.id], startsAt: now, endsAt: sale!.startsAt });
    await expect(giveEarlyAccess(f.db, shopId, sale!.id, {}, now)).rejects.toThrow("already has early access");
    const [listed] = await listSales(f.db, shopId, now);
    expect(listed!.early).toMatchObject({ code: "EARLY-BLACKFRIDAY", customerTag: null });
    // The announcement, written, with a button that applies the code.
    const day = sale!.startsAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });
    expect(await earlyAccessEmail(f.db, await f.shop(), sale!.id, now)).toEqual({
      subject: "Early access: Black Friday!, 30% off",
      body: `Hi {first_name},\n\nOur Black Friday! starts on ${day}, but you can shop it now: 30% off everything in the sale.\n\nThe button below puts your code, EARLY-BLACKFRIDAY, in your cart. It works until the sale starts.`,
      buttonLabel: "Shop early",
      buttonPath: "/discount/EARLY-BLACKFRIDAY",
      audience: "subscribers",
      audienceTag: null,
      audienceProductId: null,
    });

    // 30% off the lamp only, the same as the sale will take.
    const lamp = await quoteCart(f.db, await f.shop(), [{ variantId: small!.id, quantity: 1 }], { discountCode: code.code });
    expect(lamp.discountMinor).toBe(Math.floor(small!.priceMinor * 0.3));
    await expect(quoteCart(f.db, await f.shop(), [{ variantId: galaxy!.id, quantity: 1 }], { discountCode: code.code })).rejects.toThrow("some products only");

    // Once the sale starts, the code has done its job.
    expect((await listSales(f.db, shopId, new Date(now.getTime() + 3 * DAY)))[0]!.early).toBeNull();
    await expect(giveEarlyAccess(f.db, shopId, sale!.id, {}, new Date(now.getTime() + 3 * DAY))).rejects.toThrow("already started");

    // Stopping it turns the code off; it can be given again with a fresh code.
    await endEarlyAccess(f.db, shopId, sale!.id);
    expect((await listSales(f.db, shopId, now))[0]!.early).toBeNull();
    await expect(quoteCart(f.db, await f.shop(), [{ variantId: small!.id, quantity: 1 }], { discountCode: code.code })).rejects.toThrow("isn't a valid code");
    const again = await giveEarlyAccess(f.db, shopId, sale!.id, { hours: 24, customerTag: "VIP" }, now);
    expect(again).toMatchObject({ code: "EARLY-BLACKFRIDAY2", customerTag: "vip", startsAt: new Date(sale!.startsAt.getTime() - DAY) });

    // Deleting the sale turns its code off too.
    await deleteSale(f.db, shopId, sale!.id);
    expect((await f.db.query.discounts.findFirst({ where: eq(schema.discounts.id, again.id) }))!.active).toBe(false);
  });

  it("only lets tagged customers in when the code is for a tag", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const now = new Date();
    const [small] = await f.variants(f.products.lamp.id);
    await f.db.insert(schema.customers).values([
      { shopId, email: "ada@example.com", tags: ["vip"] },
      { shopId, email: "bob@example.com", tags: [] },
    ]);
    const [sale] = await f.db.insert(schema.sales).values({ shopId, title: "VIP night", percentOff: 20, scope: "all", startsAt: new Date(now.getTime() + DAY), endsAt: null }).returning();
    const { code } = await giveEarlyAccess(f.db, shopId, sale!.id, { customerTag: "vip" }, now);
    const lines = [{ variantId: small!.id, quantity: 1 }];
    await expect(quoteCart(f.db, await f.shop(), lines, { discountCode: code, email: "bob@example.com" })).rejects.toThrow("for some customers only");
    expect((await quoteCart(f.db, await f.shop(), lines, { discountCode: code, email: "ada@example.com" })).discountMinor).toBeGreaterThan(0);
    await expect(giveEarlyAccess(f.db, shopId, sale!.id, { hours: 5 }, now)).rejects.toThrow();
    // The email goes to the subscribers with that tag.
    expect(await earlyAccessEmail(f.db, await f.shop(), sale!.id, now)).toMatchObject({ audience: "tagged", audienceTag: "vip", body: expect.stringContaining("20% off everything.") });
    expect(await earlyAccessEmail(f.db, await f.shop(), sale!.id, new Date(now.getTime() + 2 * DAY))).toBeNull();
  });
});
