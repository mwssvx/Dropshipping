import { describe, expect, it } from "vitest";
import { checkAddress, DemoModel, editOrder, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const at = (country: string, postalCode: string, region?: string) => checkAddress({ country, postalCode, region });

describe("address check", () => {
  it("tidies postal codes into the shape each country uses", () => {
    expect(at("GB", "sw1a1aa").address?.postalCode).toBe("SW1A 1AA");
    expect(at("GB", "M1 1AE").address?.postalCode).toBe("M1 1AE");
    expect(at("CA", "k1a-0b1", "Ontario").address).toMatchObject({ postalCode: "K1A 0B1", region: "ON" });
    expect(at("NL", "1012ab").address?.postalCode).toBe("1012 AB");
    expect(at("PL", "00950").address?.postalCode).toBe("00-950");
    expect(at("PT", "1000 001").address?.postalCode).toBe("1000-001");
    expect(at("SE", "11122").address?.postalCode).toBe("111 22");
    expect(at("LV", "1050").address?.postalCode).toBe("LV-1050");
    expect(at("JP", "1000001").address?.postalCode).toBe("100-0001");
    expect(at("IE", "d02x285").address?.postalCode).toBe("D02 X285");
    expect(at("US", "787011234", "texas").address).toMatchObject({ postalCode: "78701-1234", region: "TX" });
    expect(at("US", "78701", "D.C.").address?.region).toBe("DC");
    expect(at("DE", " 10115 ").address?.postalCode).toBe("10115");
    // Countries without a known shape are taken as typed.
    expect(at("AE", "00000").address?.postalCode).toBe("00000");
  });

  it("asks the buyer to fix a code in the wrong shape, or a missing state", () => {
    expect(at("GB", "12345").problem).toEqual({ field: "postalCode", message: "Check the postal code. In the United Kingdom it looks like SW1A 1AA." });
    expect(at("DE", "1011").problem?.message).toBe("Check the postal code. In Germany it looks like 10115.");
    expect(at("CA", "D1A 0B1", "ON").problem?.field).toBe("postalCode");
    expect(at("US", "7870", "TX").problem?.field).toBe("postalCode");
    expect(at("US", "78701").problem).toEqual({ field: "region", message: "Enter the state, like TX or Texas." });
    expect(at("US", "78701", "Ontario").problem?.message).toBe("Check the state. Enter it like TX or Texas.");
    expect(at("CA", "K1A 0B1", "TX").problem?.message).toBe("Check the province. Enter it like ON or Ontario.");
  });

  it("runs at checkout and when an address is changed", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [v] = await f.variants(f.products.lamp.id);
    const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
    const lines = [{ variantId: v!.id, quantity: 1 }];
    await expect(startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address: { ...address, postalCode: "787" }, lines })).rejects.toThrow("Check the postal code. In the United States it looks like 78701.");
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address: { ...address, region: "texas", postalCode: "78701 1234" }, lines });
    expect(order.shippingAddress).toMatchObject({ region: "TX", postalCode: "78701-1234" });

    const paid = await f.waitingOrder();
    await expect(editOrder(f.ctx, shop.id, paid.id, { address: { ...paid.shippingAddress, region: "" } }, "merchant")).rejects.toThrow("Enter the state, like TX or Texas.");
  });
});
