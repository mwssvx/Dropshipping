import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { comingSoonProduct, DemoModel, joinLaunchList, launchListCount, mostWanted, publishDueProducts, schedulePublish, sendStockAlerts, setComingSoon } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("coming soon", () => {
  it("shows a teaser until the product goes on sale, then emails everyone who asked", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const { stand, lamp } = f.products;
    const now = new Date();
    const launch = new Date(now.getTime() + 2 * DAY);

    await expect(setComingSoon(f.db, shopId, stand.id, true)).rejects.toThrow("Pick when it goes on sale first");
    await expect(setComingSoon(f.db, shopId, lamp.id, true)).rejects.toThrow("Pick when it goes on sale first");
    await schedulePublish(f.db, shopId, stand.id, launch, now);
    expect(await comingSoonProduct(f.db, shopId, stand.handle, now)).toBeNull();
    await setComingSoon(f.db, shopId, stand.id, true);
    const teaser = await comingSoonProduct(f.db, shopId, stand.handle, now);
    expect(teaser).toMatchObject({ id: stand.id, publishAt: launch });
    expect(teaser!.variants.length).toBeGreaterThan(0);

    await joinLaunchList(f.db, shopId, stand.id, " Ada@Example.com ", now);
    await joinLaunchList(f.db, shopId, stand.id, "ada@example.com", now);
    await joinLaunchList(f.db, shopId, stand.id, "grace@example.com", now);
    await expect(joinLaunchList(f.db, shopId, stand.id, "nope", now)).rejects.toThrow("Enter your email");
    await expect(joinLaunchList(f.db, shopId, lamp.id, "ada@example.com", now)).rejects.toThrow("isn't coming soon");
    expect(await launchListCount(f.db, shopId, stand.id)).toBe(2);
    // Not counted as waiting for a restock.
    expect(await mostWanted(f.db, shopId)).toEqual([]);

    // Nothing goes out while it's still a draft.
    const ctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example", now: () => new Date(launch.getTime() + 60_000) };
    expect(await sendStockAlerts(ctx, { shopId })).toEqual({ sent: 0 });
    await f.db.update(schema.variants).set({ stock: null }).where(eq(schema.variants.productId, stand.id));
    expect((await publishDueProducts(f.db, shopId, new Date(launch.getTime() + 1))).map((p) => p.id)).toEqual([stand.id]);
    expect(await comingSoonProduct(f.db, shopId, stand.handle, new Date(launch.getTime() + 1))).toBeNull();
    expect(await sendStockAlerts(ctx, { shopId })).toEqual({ sent: 2 });
    const mail = f.mailer.sent.find((m) => m.to === "ada@example.com")!;
    expect(mail.subject).toBe(`Out now: ${stand.title}`);
    expect(mail.text).toContain(`is on sale now at Glow Lamps. You asked us to let you know.`);
    expect(mail.text).toContain(`https://glow.example/products/${stand.handle}`);
    expect(await sendStockAlerts(ctx, { shopId })).toEqual({ sent: 0 });
    expect(await launchListCount(f.db, shopId, stand.id)).toBe(0);
  });
});
