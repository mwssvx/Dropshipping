import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, savedAddresses, SAVED_ADDRESSES_MAX } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("saved addresses at checkout", () => {
  it("lists the different places a buyer's orders went, newest first", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const home = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
    const work = { name: "Ada Lovelace", line1: "500 Congress Ave", line2: "Floor 3", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
    const mum = { name: "Mary Lovelace", line1: "9 Elm Rd", city: "Dallas", region: "TX", postalCode: "75201", country: "US" };
    const place = async (address: typeof home, daysAgo: number, extra: Partial<typeof schema.orders.$inferInsert> = {}) => {
      const o = await f.waitingOrder();
      await f.db.update(schema.orders).set({ email: "ada@example.com", shippingAddress: address, paidAt: new Date(Date.now() - daysAgo * DAY), ...extra }).where(eq(schema.orders.id, o.id));
    };
    expect(await savedAddresses(f.db, shop.id, "ada@example.com")).toEqual([]);
    await place(home, 30);
    await place(work, 20);
    // The same place typed a little differently counts once.
    await place({ ...home, line1: "1  main st ", name: "ada lovelace" }, 10);
    await place(mum, 5);
    // Left out: an unpaid try and a pickup.
    await place({ ...mum, line1: "Unpaid Rd" }, 1, { paymentStatus: "pending" });
    await place({ ...mum, line1: "Pickup Rd" }, 1, { pickup: true });

    const list = await savedAddresses(f.db, shop.id, "ADA@example.com");
    expect(list.map((a) => a.line1)).toEqual(["9 Elm Rd", "1  main st ", "500 Congress Ave"]);
    expect(list[2]).toMatchObject({ line2: "Floor 3" });
    // Another buyer sees none of these.
    expect(await savedAddresses(f.db, shop.id, "someone@example.com")).toEqual([]);

    for (let i = 0; i < 6; i++) await place({ ...home, line1: `${i + 2} New St` }, 0);
    expect(await savedAddresses(f.db, shop.id, "ada@example.com")).toHaveLength(SAVED_ADDRESSES_MAX);
  });
});
