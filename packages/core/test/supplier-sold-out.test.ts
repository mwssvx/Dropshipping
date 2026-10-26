import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, notifySoldOut, soldOutAtSupplier, todaySummary, weeklySummary } from "../src";
import { makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const { lamp, projector } = f.products;
  const stock = (productId: string, n: number | null) => f.db.update(schema.variants).set({ stock: n }).where(eq(schema.variants.productId, productId));
  await stock(projector.id, 5);
  await stock(lamp.id, 0);
  f.mailer.sent.length = 0;
  const shopId = (await f.shop()).id;
  const notify = (now = new Date()) => notifySoldOut({ db: f.db, mailer: f.mailer, adminUrl: (p) => `https://app.example${p}` }, { shopId, now });
  return { ...f, stock, notify, lamp, projector };
}

describe("sold out at the supplier", () => {
  it("lists products on sale whose every option ran out", async () => {
    const f = await setup();
    const shopId = (await f.shop()).id;
    expect((await soldOutAtSupplier(f.db, shopId)).map((p) => p.title)).toEqual(["Sunset Projection Lamp"]);

    // One option left is enough to sell, and so is an option with no stock count.
    const [first] = await f.variants(f.lamp.id);
    await f.db.update(schema.variants).set({ stock: null }).where(eq(schema.variants.id, first!.id));
    expect(await soldOutAtSupplier(f.db, shopId)).toEqual([]);
    await f.stock(f.lamp.id, 0);

    // Drafts, products added by hand and products taking pre-orders aren't counted.
    await f.db.update(schema.products).set({ preorder: { shipsBy: "2099-01-01", limit: null } }).where(eq(schema.products.id, f.lamp.id));
    expect(await soldOutAtSupplier(f.db, shopId)).toEqual([]);
    await f.db.update(schema.products).set({ preorder: null, sourceUrl: null }).where(eq(schema.products.id, f.lamp.id));
    expect(await soldOutAtSupplier(f.db, shopId)).toEqual([]);
    await f.db.update(schema.products).set({ status: "draft", sourceUrl: f.lamp.sourceUrl }).where(eq(schema.products.id, f.lamp.id));
    expect(await soldOutAtSupplier(f.db, shopId)).toEqual([]);
  });

  it("emails the team once, and again only after it comes back and runs out again", async () => {
    const f = await setup();
    expect(await f.notify()).toEqual({ sent: 1, back: 0 });
    const mail = f.mailer.sent[0]!;
    expect(mail.to).toBe("owner@example.com");
    expect(mail.subject).toBe("Sunset Projection Lamp sold out at the supplier (Glow Lamps)");
    expect(mail.text).toContain("so buyers can't order it on Glow Lamps right now");
    expect(mail.text).toContain(`Sunset Projection Lamp: https://app.example/admin/products/${f.lamp.id}`);
    expect(mail.text).toContain("Add a backup supplier");

    // Nothing new: no email.
    expect(await f.notify()).toEqual({ sent: 0, back: 0 });

    // Back in stock, then out again: told again, this time with the projector too.
    await f.stock(f.lamp.id, 3);
    expect(await f.notify()).toEqual({ sent: 0, back: 1 });
    await f.stock(f.lamp.id, 0);
    await f.stock(f.projector.id, 0);
    expect(await f.notify()).toEqual({ sent: 1, back: 0 });
    expect(f.mailer.sent[1]!.subject).toBe("2 products sold out at the supplier (Glow Lamps)");
    expect(f.mailer.sent[1]!.text).toMatch(/Galaxy Projector: .*\n {2}Sunset Projection Lamp: /);
  });

  it("shows on Today and in the Monday summary for people who look after products", async () => {
    const f = await setup();
    const shop = await f.shop();
    const item = (await todaySummary(f.db, shop, new Date(), "staff")).attention.find((a) => a.kind === "sold_out");
    expect(item).toMatchObject({ title: "Sunset Projection Lamp sold out at the supplier", url: "/products#supplier-sold-out", tone: "warning" });
    expect((await weeklySummary(f.db, shop)).waiting.map((w) => w.kind)).toContain("sold_out");
  });
});
