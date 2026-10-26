import { describe, expect, it } from "vitest";
import { createProduct, DemoModel, duplicateProduct, getProduct, listActiveProducts, listProducts, patchProduct, publishDueProducts, schedulePublish, updateProduct } from "../src";
import { makeFixture } from "../evals/fixture";

const HOUR = 3_600_000;

describe("put a product on sale later", () => {
  it("goes on sale by itself once its time comes", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const drop = await createProduct(f.db, shop.id, { title: "Limited Lamp", variants: [{ title: "Default", priceMinor: 4000 }] });
    const now = new Date();
    await expect(schedulePublish(f.db, shop.id, drop.id, new Date(now.getTime() - HOUR), now)).rejects.toThrow("time in the future");
    await expect(schedulePublish(f.db, shop.id, drop.id, new Date(now.getTime() + 400 * 24 * HOUR), now)).rejects.toThrow("within 365 days");
    await expect(schedulePublish(f.db, shop.id, f.products.lamp.id, new Date(now.getTime() + HOUR), now)).rejects.toThrow("already on sale");

    const at = new Date(now.getTime() + 2 * HOUR);
    await schedulePublish(f.db, shop.id, drop.id, at, now);
    expect((await getProduct(f.db, shop.id, drop.id)).publishAt).toEqual(at);
    // Not yet: buyers don't see it.
    expect(await publishDueProducts(f.db, shop.id, new Date(now.getTime() + HOUR))).toEqual([]);
    expect((await listActiveProducts(f.db, shop.id)).some((p) => p.id === drop.id)).toBe(false);
    // A copy doesn't take the original's launch time with it.
    expect((await duplicateProduct(f.db, shop.id, drop.id)).publishAt).toBeNull();

    const live = await publishDueProducts(f.db, undefined, new Date(at.getTime() + 1000));
    expect(live).toEqual([{ id: drop.id, shopId: shop.id, title: "Limited Lamp" }]);
    expect(await getProduct(f.db, shop.id, drop.id)).toMatchObject({ status: "active", publishAt: null });
    expect((await listActiveProducts(f.db, shop.id)).some((p) => p.id === drop.id)).toBe(true);
  });

  it("is listed as on sale as soon as it's due, and cancelled when the status changes by hand", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const due = await createProduct(f.db, shop.id, { title: "Due", variants: [{ title: "Default", priceMinor: 1000 }] });
    // Scheduled from "an hour ago", so it's due now: the admin list puts it on sale first.
    await schedulePublish(f.db, shop.id, due.id, new Date(Date.now() - 1000), new Date(Date.now() - HOUR));
    expect((await listProducts(f.db, shop.id)).find((p) => p.id === due.id)?.status).toBe("active");

    const later = new Date(Date.now() + 24 * HOUR);
    const a = await createProduct(f.db, shop.id, { title: "Edited live", variants: [{ title: "Default", priceMinor: 1000 }] });
    await schedulePublish(f.db, shop.id, a.id, later);
    await updateProduct(f.db, shop.id, a.id, { title: "Edited live", status: "active", variants: [{ title: "Default", priceMinor: 1000 }] });
    expect((await getProduct(f.db, shop.id, a.id)).publishAt).toBeNull();
    const b = await createProduct(f.db, shop.id, { title: "From the app", variants: [{ title: "Default", priceMinor: 1000 }] });
    await schedulePublish(f.db, shop.id, b.id, later);
    await patchProduct(f.db, shop.id, b.id, { status: "archived" });
    expect((await getProduct(f.db, shop.id, b.id)).publishAt).toBeNull();
    // Saving a draft as a draft keeps its launch time.
    const c = await createProduct(f.db, shop.id, { title: "Still a draft", variants: [{ title: "Default", priceMinor: 1000 }] });
    await schedulePublish(f.db, shop.id, c.id, later);
    await updateProduct(f.db, shop.id, c.id, { title: "Still a draft!", status: "draft", variants: [{ title: "Default", priceMinor: 1200 }] });
    expect((await getProduct(f.db, shop.id, c.id)).publishAt).toEqual(later);
    await schedulePublish(f.db, shop.id, c.id, null);
    expect((await getProduct(f.db, shop.id, c.id)).publishAt).toBeNull();
  });
});
