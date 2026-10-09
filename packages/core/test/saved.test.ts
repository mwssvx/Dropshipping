import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  DemoModel, eraseCustomer, exportCustomerData, listSaved, lowestPrice, mergeSaved, mostSaved, saveItem, savedCount, savedIdsFrom, savedProductIds, sendPriceDrops, setPriceAlerts, unsaveItem,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = await f.shop();
  await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, f.products.stand.id));
  const customer = async (email: string) => (await f.db.insert(schema.customers).values({ shopId: shop.id, email }).returning())[0]!;
  const ctx = { ...f.ctx, storeAddress: () => "https://glow.example" };
  const setPrice = async (productId: string, priceMinor: number) => f.db.update(schema.variants).set({ priceMinor }).where(eq(schema.variants.productId, productId));
  return { ...f, shop, customer, ctx, setPrice };
}

describe("saved items", () => {
  it("guests keep a list in a cookie that joins their account when they sign in", async () => {
    const f = await setup();
    const { lamp, stand, projector } = f.products;
    expect(savedIdsFrom([lamp.id, lamp.id, "not-an-id", 42, stand.id])).toEqual([lamp.id, stand.id]);
    expect(savedIdsFrom("nope")).toEqual([]);
    const guest = await listSaved(f.db, f.shop.id, { productIds: [lamp.id, stand.id] });
    expect(guest.map((s) => s.id)).toEqual([stand.id, lamp.id]); // newest first
    expect(guest[0]!.savedPriceMinor).toBeNull();

    const ada = await f.customer("ada@example.com");
    await saveItem(f.db, f.shop.id, ada.id, projector.id);
    await mergeSaved(f.db, f.shop.id, ada.id, [lamp.id, projector.id, "00000000-0000-0000-0000-000000000000"]);
    expect((await savedProductIds(f.db, ada.id)).sort()).toEqual([lamp.id, projector.id].sort());
    await expect(saveItem(f.db, "00000000-0000-0000-0000-000000000000", ada.id, lamp.id)).rejects.toThrow("not found");

    // Archived products drop off the list.
    await f.db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.id, projector.id));
    expect((await listSaved(f.db, f.shop.id, { customerId: ada.id })).map((s) => s.id)).toEqual([lamp.id]);
    await unsaveItem(f.db, ada.id, lamp.id);
    expect(await listSaved(f.db, f.shop.id, { customerId: ada.id })).toEqual([]);
  });

  it("emails once when a saved item gets cheaper, and the merchant sees what's saved", async () => {
    const f = await setup();
    const { lamp, stand } = f.products;
    const ada = await f.customer("ada@example.com");
    const grace = await f.customer("grace@example.com");
    const was = lowestPrice(await f.variants(lamp.id))!;
    expect(was).toBe(Math.min(...(await f.variants(lamp.id)).map((v) => v.priceMinor)));
    await saveItem(f.db, f.shop.id, ada.id, lamp.id);
    await saveItem(f.db, f.shop.id, ada.id, stand.id);
    await saveItem(f.db, f.shop.id, grace.id, lamp.id);
    await setPriceAlerts(f.db, f.shop.id, grace.id, false);
    expect(await savedCount(f.db, f.shop.id, lamp.id)).toBe(2);
    expect((await mostSaved(f.db, f.shop.id))[0]).toMatchObject({ productId: lamp.id, saved: 2 });

    // Same price, or a few cents' rounding: nothing.
    expect(await sendPriceDrops(f.ctx)).toEqual({ sent: 0 });
    await f.setPrice(lamp.id, was - 1);
    expect(await sendPriceDrops(f.ctx)).toEqual({ sent: 0 });

    // A real drop on both: Ada gets one email listing both; Grace turned them off.
    await f.setPrice(lamp.id, was - 300);
    const standWas = lowestPrice(await f.variants(stand.id))!;
    await f.setPrice(stand.id, standWas - 200);
    const sentBefore = f.mailer.sent.length;
    expect(await sendPriceDrops(f.ctx)).toEqual({ sent: 1 });
    const mail = f.mailer.sent.at(-1)!;
    expect(f.mailer.sent.length).toBe(sentBefore + 1);
    expect(mail).toMatchObject({ to: "ada@example.com", subject: "2 things you saved are cheaper" });
    expect(mail.text).toContain(`https://glow.example/products/${lamp.handle}`);
    expect(mail.text).toContain("https://glow.example/saved");
    expect((await listSaved(f.db, f.shop.id, { customerId: ada.id })).find((s) => s.id === lamp.id)).toMatchObject({ priceMinor: was - 300, savedPriceMinor: was });

    // Another drop the same day waits; the next day it goes.
    await f.setPrice(lamp.id, was - 600);
    expect(await sendPriceDrops(f.ctx)).toEqual({ sent: 0 });
    f.advance(DAY + 1);
    expect(await sendPriceDrops(f.ctx)).toEqual({ sent: 1 });
    expect(f.mailer.sent.at(-1)!.subject).toBe(`Price drop: ${lamp.title}`);

    // Sold out: no email even if cheaper.
    f.advance(DAY + 1);
    await f.db.update(schema.variants).set({ priceMinor: was - 900, stock: 0 }).where(eq(schema.variants.productId, lamp.id));
    expect(await sendPriceDrops(f.ctx)).toEqual({ sent: 0 });

    // Their list is part of their data, and goes when it's erased.
    const data = await exportCustomerData(f.db, f.shop, ada.id);
    expect(data.saved_items.map((s) => s.product).sort()).toEqual([lamp.title, stand.title].sort());
    await eraseCustomer(f.db, f.shop.id, ada.id, { confirmEmail: "ada@example.com" });
    expect(await savedCount(f.db, f.shop.id, stand.id)).toBe(0);
  });
});
