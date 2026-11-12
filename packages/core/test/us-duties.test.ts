import { describe, expect, it } from "vitest";
import { createTestDb } from "@sf/db";
import { createShop, defaultWarehouse, mainMarket, signUp, usDutyWarning, zonesReach } from "../src";

const w = (name: string, country: string | null) => ({ name, country, variants: 1, fastestDays: null, lowestCostMinor: 100 });

describe("US import duties when pricing", () => {
  it("warns about parcels into the US from abroad, only when the store sells there", () => {
    expect(usDutyWarning("CN", true)).toContain("US buyers may owe import duty and a customs fee on parcels from China");
    expect(usDutyWarning("US", true)).toBeNull();
    expect(usDutyWarning("CN", false)).toBeNull();
  });

  it("starts on the store's own warehouse, then where its buyers are, then China", () => {
    const list = [w("China", "CN"), w("United States", "US"), w("Spain", "ES")];
    expect(defaultWarehouse(list, "ES", "US")).toBe("Spain");
    expect(defaultWarehouse(list, "DE", "US")).toBe("United States");
    expect(defaultWarehouse(list, "DE", null)).toBe("China");
    expect(defaultWarehouse([w("Spain", "ES"), w("Poland", "PL")], "DE", "US")).toBe("Spain");
  });

  it("takes the US as the main market of a new store that ships there", async () => {
    const db = await createTestDb();
    const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
    const shop = await createShop(db, user.id, { name: "Fans", country: "DE" });
    expect(await zonesReach(db, shop.id, "US")).toBe(true);
    expect(await mainMarket(db, shop.id)).toBe("US");
  });
});
