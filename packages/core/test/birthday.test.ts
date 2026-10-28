import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { birthdaysKnown, birthdayStats, birthdayValue, createShop, DemoModel, exportStore, formatBirthday, importStore, listDiscounts, quoteCart, sendBirthdayCodes, setBirthday, setBirthdayOffer, signUp } from "../src";
import { makeFixture } from "../evals/fixture";

describe("birthday codes", () => {
  it("checks the terms and the date", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await expect(setBirthdayOffer(f.db, shopId, { percentOff: 60, days: 14 })).rejects.toThrow("5% to 50%");
    await expect(setBirthdayOffer(f.db, shopId, { percentOff: 10, days: 90 })).rejects.toThrow("7 to 60 days");
    expect(await setBirthdayOffer(f.db, shopId, { percentOff: 15, days: 14 })).toEqual({ percentOff: 15, days: 14 });
    await setBirthdayOffer(f.db, shopId, null);
    expect((await f.shop()).birthdayOffer).toBeNull();

    expect(birthdayValue(7, 4)).toBe("07-04");
    expect(birthdayValue(2, 29)).toBe("02-29");
    expect(birthdayValue(null, null)).toBeNull();
    expect(() => birthdayValue(2, 30)).toThrow("Pick the month and the day");
    expect(() => birthdayValue(13, 1)).toThrow();
    expect(() => birthdayValue(7, null)).toThrow();
    expect(formatBirthday("07-04")).toBe("July 4");
    expect(formatBirthday("02-29")).toBe("February 29");
    expect(formatBirthday(null)).toBeNull();
  });

  it("emails subscribers a code on their birthday, once a year", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [small] = await f.variants(f.products.lamp.id);
    // Dates ahead of today, so the codes still work when the test quotes a cart.
    let clock = new Date("2030-07-04T09:00:00Z");
    const cctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example", now: () => clock };
    const add = async (email: string, birthday: [number, number] | null, o: { subscribed?: boolean; unsubscribed?: boolean } = {}) => {
      await f.db.insert(schema.customers).values({ shopId: shop.id, email, name: email.split("@")[0], acceptsMarketing: o.subscribed ?? true, unsubscribedAt: o.unsubscribed ? clock : null });
      if (birthday) await setBirthday(f.db, shop.id, email, ...birthday);
    };
    await add("ada@example.com", [7, 4]);
    await add("bob@example.com", [7, 4], { subscribed: false });
    await add("cy@example.com", [7, 4], { unsubscribed: true });
    await add("dee@example.com", [7, 5]);
    await add("eve@example.com", null);
    await add("leap@example.com", [2, 29]);
    expect(await birthdaysKnown(f.db, shop.id)).toBe(3);

    // Off until the merchant turns it on.
    expect(await sendBirthdayCodes(cctx)).toEqual({ sent: 0 });
    await setBirthdayOffer(f.db, shop.id, { percentOff: 20, days: 14 });
    expect(await sendBirthdayCodes(cctx)).toEqual({ sent: 1 });
    const mail = f.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "ada@example.com", subject: "Happy birthday from Glow Lamps: 20% off" });
    const code = mail.text.match(/BDAY-[A-HJ-NP-Z2-9]{6}/)![0];
    expect(mail.text).toContain(`https://glow.example/discount/${code}`);
    expect(mail.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/glow\.example\/unsubscribe\/.+\/one-click>$/);
    // Once a year, even if the job runs again that day.
    expect(await sendBirthdayCodes(cctx)).toEqual({ sent: 0 });
    // Not on the merchant's list of codes, and only Ada's to use.
    expect(await listDiscounts(f.db, shop.id)).toEqual([]);
    await expect(quoteCart(f.db, await f.shop(), [{ variantId: small!.id, quantity: 1 }], { discountCode: code, email: "bob@example.com" })).rejects.toThrow();
    const quote = await quoteCart(f.db, await f.shop(), [{ variantId: small!.id, quantity: 1 }], { discountCode: code, email: "ada@example.com" });
    expect(quote.discountMinor).toBeGreaterThan(0);
    expect(await birthdayStats(f.db, shop.id)).toEqual({ sent: 1, used: 0, salesMinor: 0 });

    // Dee's is the next day.
    clock = new Date("2030-07-05T09:00:00Z");
    expect(await sendBirthdayCodes(cctx)).toEqual({ sent: 1 });
    expect(f.mailer.sent.at(-1)!.to).toBe("dee@example.com");

    // February 29 birthdays get theirs on the 28th outside leap years, and on the 29th in them.
    clock = new Date("2031-02-28T09:00:00Z");
    expect(await sendBirthdayCodes(cctx)).toEqual({ sent: 1 });
    expect(f.mailer.sent.at(-1)!.to).toBe("leap@example.com");
    clock = new Date("2032-02-28T09:00:00Z");
    expect(await sendBirthdayCodes(cctx)).toEqual({ sent: 0 });
    clock = new Date("2032-02-29T09:00:00Z");
    expect(await sendBirthdayCodes(cctx)).toEqual({ sent: 1 });

    // A year on, Ada gets another.
    clock = new Date("2031-07-04T09:00:00Z");
    expect(await sendBirthdayCodes(cctx)).toEqual({ sent: 1 });
    expect(f.mailer.sent.filter((m) => m.subject.startsWith("Happy birthday")).map((m) => m.to)).toEqual(["ada@example.com", "dee@example.com", "leap@example.com", "leap@example.com", "ada@example.com"]);

    // Clearing it stops the codes.
    await setBirthday(f.db, shop.id, "ada@example.com", null, null);
    expect((await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "ada@example.com") }))!.birthday).toBeNull();

    // Store files carry the setting.
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.store.birthday_offer).toEqual({ percent_off: 20, days: 14 });
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!.birthdayOffer).toEqual({ percentOff: 20, days: 14 });
  });
});
