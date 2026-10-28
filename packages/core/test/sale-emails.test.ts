import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { DemoModel, saleEmail } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("sale emails", () => {
  it("writes 'it's on' while there's time, and 'last chance' in a sale's last two days", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    // Thursday Nov 28, 10 am in New York (a US store's time zone).
    const now = new Date("2030-11-28T15:00:00Z");
    const startsAt = new Date(now.getTime() - DAY);
    const [week, tonight, today, tomorrow, later] = await f.db
      .insert(schema.sales)
      .values([
        { shopId: shop.id, title: "Black Friday week", percentOff: 25, scope: "all", startsAt, endsAt: new Date("2030-12-05T20:00:00Z") },
        { shopId: shop.id, title: "Night owls", percentOff: 10, scope: "all", startsAt, endsAt: new Date("2030-11-29T04:59:00Z") },
        { shopId: shop.id, title: "Morning", percentOff: 10, scope: "all", startsAt, endsAt: new Date("2030-11-28T16:00:00Z") },
        { shopId: shop.id, title: "Lamp days", percentOff: 20, scope: "products", productIds: [f.products.lamp.id], startsAt, endsAt: new Date("2030-11-29T20:00:00Z") },
        { shopId: shop.id, title: "Cyber Monday", percentOff: 30, scope: "all", startsAt: new Date("2030-12-02T05:00:00Z"), endsAt: null },
      ])
      .returning();

    expect(await saleEmail(f.db, shop, week!.id, now)).toEqual({
      subject: "Black Friday week: 25% off everything",
      body: "Hi {first_name},\n\nOur Black Friday week is on: 25% off everything, until Thursday, December 5.\n\nThe prices are already lower on the store, so there's no code to type.",
      buttonLabel: "Shop the sale",
      buttonPath: "/",
      audience: "subscribers",
      audienceTag: null,
      audienceProductId: null,
    });
    expect(await saleEmail(f.db, shop, tonight!.id, now)).toMatchObject({ subject: "Last chance: Night owls ends tonight", buttonLabel: "Shop before it ends" });
    expect(await saleEmail(f.db, shop, today!.id, now)).toMatchObject({ subject: "Last chance: Morning ends today" });
    const lamp = (await f.db.query.products.findFirst({ where: (p, { eq }) => eq(p.id, f.products.lamp.id) }))!;
    expect(await saleEmail(f.db, shop, tomorrow!.id, now)).toMatchObject({
      subject: "Last chance: Lamp days ends tomorrow",
      body: `Hi {first_name},\n\nOur Lamp days ends tomorrow: 20% off the ${lamp.title} until then. After that, prices go back up.`,
      buttonPath: `/products/${lamp.handle}`,
    });
    // Two days before the week's end it's "on Thursday"; a sale that hasn't started has no email yet.
    expect(await saleEmail(f.db, shop, week!.id, new Date("2030-12-03T21:00:00Z"))).toMatchObject({ subject: "Last chance: Black Friday week ends on Thursday" });
    expect(await saleEmail(f.db, shop, later!.id, now)).toBeNull();
  });
});
