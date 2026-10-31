import { describe, expect, it } from "vitest";
import { crossesCustoms, DemoModel, draftPolicies, dutiesFor, exportStore, setCustomsInfo, setDuties, shipsFromOf } from "../src";
import { makeFixture } from "../evals/fixture";

describe("import duties", () => {
  it("says who pays duties only for orders that cross customs", async () => {
    expect(crossesCustoms("US", "US")).toBe(false);
    expect(crossesCustoms("US", "GB")).toBe(true);
    expect(crossesCustoms("DE", "FR")).toBe(false);
    expect(crossesCustoms("DE", "GB")).toBe(true);
    expect(crossesCustoms("GB", "IE")).toBe(true);

    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    expect(shop.duties).toBe("off");
    expect(dutiesFor(shop, "GB")).toBeNull();
    await expect(setDuties(f.db, shop.id, "sometimes")).rejects.toThrow("Pick what buyers abroad are told");
    expect(await setDuties(f.db, shop.id, "buyer_pays")).toBe("buyer_pays");
    const paying = await f.shop();
    expect(dutiesFor(paying, "GB")).toBe("buyer_pays");
    expect(dutiesFor(paying, "US")).toBeNull();
    expect((await draftPolicies(f.db, paying)).find((p) => p.kind === "shipping")!.body).toContain("These are paid by the buyer when the parcel arrives.");

    await setDuties(f.db, shop.id, "included");
    const included = await f.shop();
    expect(dutiesFor(included, "CA")).toBe("included");
    expect((await draftPolicies(f.db, included)).find((p) => p.kind === "shipping")!.body).toContain("are included in our prices");
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.store.duties).toBe("included");
  });

  it("puts the same note on the receipt for orders abroad", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const receipt = (o: { number: number; email: string }) => f.mailer.sent.find((m) => m.to === o.email && m.subject === `Order #${o.number} confirmed`)!.text;
    const before = await f.order(f.products.lamp.id, { country: "GB" });
    expect(receipt(before)).not.toContain("import duties");

    await setDuties(f.db, shop.id, "buyer_pays");
    const abroad = await f.order(f.products.lamp.id, { country: "GB" });
    expect(receipt(abroad)).toContain("Customs may charge import duties or taxes when it arrives. They're paid to the courier and weren't part of this total.");
    const home = await f.order(f.products.lamp.id);
    expect(receipt(home)).not.toContain("import duties");

    await setDuties(f.db, shop.id, "included");
    const included = await f.order(f.products.lamp.id, { country: "FR" });
    expect(receipt(included)).toContain("Import duties and taxes are included, so there's nothing more to pay when it arrives.");
  });

  it("follows a product that ships from a warehouse abroad", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const lamp = f.products.lamp.id;
    await expect(setCustomsInfo(f.db, shop.id, lamp, { shipsFrom: "Narnia" })).rejects.toThrow("the country it ships from as a two-letter code");
    // The store's own country means the same as empty.
    expect((await setCustomsInfo(f.db, shop.id, lamp, { shipsFrom: shop.country.toLowerCase() })).shipsFrom).toBeNull();
    expect((await setCustomsInfo(f.db, shop.id, lamp, { hsCode: "6912.00", shipsFrom: "cn" })).shipsFrom).toBe("CN");
    // Saving without it leaves it alone.
    expect((await setCustomsInfo(f.db, shop.id, lamp, { hsCode: "" })).shipsFrom).toBe("CN");
    expect(await shipsFromOf(f.db, { productIds: [lamp] })).toEqual(["CN"]);

    await setDuties(f.db, shop.id, "buyer_pays");
    const paying = await f.shop();
    // From China, a buyer in the store's own country pays duties too; a cart counts if one item crosses.
    expect(dutiesFor(paying, shop.country, "CN")).toBe("buyer_pays");
    expect(dutiesFor(paying, shop.country, [null, "CN"])).toBe("buyer_pays");
    expect(dutiesFor(paying, shop.country, [null])).toBeNull();
    expect(dutiesFor(paying, "CN", "CN")).toBeNull();

    const home = await f.order(lamp);
    expect(await shipsFromOf(f.db, { orderId: home.id })).toEqual(["CN"]);
    const receipt = f.mailer.sent.find((m) => m.to === home.email && m.subject === `Order #${home.number} confirmed`)!.text;
    expect(receipt).toContain("Customs may charge import duties or taxes when it arrives.");

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.products.find((p: { handle: string }) => p.handle === f.products.lamp.handle).ships_from).toBe("CN");
  });
});
