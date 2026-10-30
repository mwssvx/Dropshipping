import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { cartLinkSource, createCartLink, DemoModel, deleteCartLink, listCartLinks, openCartLink } from "../src";
import { makeFixture } from "../evals/fixture";

describe("cart links", () => {
  it("fills a cart from one link and counts what it sold", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const { lamp, projector, stand } = f.products;
    const [lampV] = await f.variants(lamp.id);
    const [projV] = await f.variants(projector.id);
    const [standV] = await f.variants(stand.id);
    await f.db.insert(schema.discounts).values({ shopId, code: "DM10", kind: "percent", value: 10 });

    await expect(createCartLink(f.db, shopId, { name: " ", lines: [{ variantId: lampV!.id, quantity: 1 }] })).rejects.toThrow("Give the link a name");
    await expect(createCartLink(f.db, shopId, { name: "DM", lines: [] })).rejects.toThrow("at least one product");
    await expect(createCartLink(f.db, shopId, { name: "DM", lines: [{ variantId: lampV!.id, quantity: 0 }] })).rejects.toThrow("from 1 to 99");
    await expect(createCartLink(f.db, shopId, { name: "DM", lines: [{ variantId: lampV!.id, quantity: 1 }], discountCode: "nope" })).rejects.toThrow("There's no code NOPE");

    const link = await createCartLink(f.db, shopId, {
      name: "Instagram DM",
      lines: [{ variantId: lampV!.id, quantity: 1 }, { variantId: projV!.id, quantity: 2 }, { variantId: lampV!.id, quantity: 1 }, { variantId: standV!.id, quantity: 1 }],
      discountCode: "dm10",
    });
    expect(link.lines).toEqual([{ variantId: lampV!.id, quantity: 2 }, { variantId: projV!.id, quantity: 2 }, { variantId: standV!.id, quantity: 1 }]);
    expect(link.discountCode).toBe("DM10");
    await expect(createCartLink(f.db, shopId, { name: "instagram  dm", lines: [{ variantId: lampV!.id, quantity: 1 }] })).rejects.toThrow("already have a link");

    // The draft stand and a sold-out option stay out of the cart.
    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.id, projV!.id));
    expect(await openCartLink(f.db, shopId, link.token)).toEqual({ lines: [{ variantId: lampV!.id, quantity: 2 }], discountCode: "DM10", source: "link-instagram-dm" });
    expect(await openCartLink(f.db, shopId, "nope-nope")).toBeNull();
    expect(await openCartLink(f.db, "00000000-0000-4000-8000-000000000000", link.token)).toBeNull();

    // Orders whose visit came through the link count as its sales.
    expect(cartLinkSource(link.name)).toBe("link-instagram-dm");
    const paid = await f.order(lamp.id);
    await f.db.update(schema.orders).set({ visitSource: "link-instagram-dm" }).where(eq(schema.orders.id, paid.id));
    const [row] = await listCartLinks(f.db, shopId);
    expect(row).toMatchObject({ name: "Instagram DM", clicks: 1, orders: 1 });
    expect(row!.salesMinor).toBeGreaterThan(0);
    expect(row!.items.map((i) => [i.quantity, i.onSale])).toEqual([[2, true], [2, true], [1, false]]);

    await deleteCartLink(f.db, shopId, link.id);
    expect(await listCartLinks(f.db, shopId)).toEqual([]);
  });
});
