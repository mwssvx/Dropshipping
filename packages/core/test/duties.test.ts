import { describe, expect, it } from "vitest";
import { crossesCustoms, DemoModel, draftPolicies, dutiesFor, exportStore, setDuties } from "../src";
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
});
