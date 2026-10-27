import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createProduct, DemoModel, exportStore, notifyLowStock, runningLow, setRestockAlert } from "../src";
import { makeFixture } from "../evals/fixture";

describe("running low", () => {
  it("lists the store's own options at or under its number and emails the team once per option", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const mug = await createProduct(f.db, shop.id, {
      title: "Mug",
      status: "active",
      variants: [
        { title: "Blue", priceMinor: 1500, stock: 4 },
        { title: "Red", priceMinor: 1500, stock: 0 },
        { title: "Green", priceMinor: 1500 },
      ],
    });
    await createProduct(f.db, shop.id, { title: "Poster", status: "draft", variants: [{ title: "Default", priceMinor: 900, stock: 1 }] });
    await f.db.update(schema.variants).set({ stock: 1 }).where(eq(schema.variants.productId, f.products.lamp.id));
    const ctx = { db: f.db, mailer: f.mailer, adminUrl: (p: string) => `https://app.example${p}` };
    const mails = () => f.mailer.sent.filter((m) => m.to === "owner@example.com" && /running low|sold out/.test(m.subject) && m.subject.includes("Glow Lamps"));

    // Imported products, drafts and options without a count aren't listed; the default number is 3.
    expect(await runningLow(f.db, shop.id)).toMatchObject([{ title: "Mug – Red", stock: 0 }]);
    await notifyLowStock(ctx);
    expect(mails().map((m) => m.subject)).toEqual(["Mug – Red is sold out (Glow Lamps)"]);
    expect(mails()[0]!.text).toContain("Mug – Red: sold out. https://app.example/admin/products/");

    // The Blue sells down: only it is new.
    const [blue, red] = await f.variants(mug.id);
    await f.db.update(schema.variants).set({ stock: 2 }).where(eq(schema.variants.id, blue!.id));
    await notifyLowStock(ctx);
    await notifyLowStock(ctx);
    expect(mails().map((m) => m.subject)).toEqual(["Mug – Red is sold out (Glow Lamps)", "Mug – Blue is running low (Glow Lamps)"]);
    expect(mails()[1]!.text).toContain("Mug – Blue: 2 left.");

    // Restocked, then low again: told again.
    await f.db.update(schema.variants).set({ stock: 10 }).where(eq(schema.variants.id, red!.id));
    expect(await notifyLowStock(ctx)).toMatchObject({ back: 1, sent: 0 });
    await f.db.update(schema.variants).set({ stock: 1 }).where(eq(schema.variants.id, red!.id));
    await notifyLowStock(ctx);
    expect(mails()).toHaveLength(3);

    // A higher number lists more; 0 turns it off.
    await expect(setRestockAlert(f.db, shop.id, -1)).rejects.toThrow("from 0 to 1000");
    await setRestockAlert(f.db, shop.id, 5);
    expect((await runningLow(f.db, shop.id)).map((r) => r.title)).toEqual(["Mug – Red", "Mug – Blue"]);
    await notifyLowStock(ctx);
    expect(mails().at(-1)!.subject).toBe("2 options are running low (Glow Lamps)");
    expect((await exportStore(f.db, shop.id)).store.restock_alert_at).toBe(5);
    await setRestockAlert(f.db, shop.id, 0);
    expect(await runningLow(f.db, shop.id)).toEqual([]);
    expect((await notifyLowStock(ctx)).sent).toBe(0);
  });
});
