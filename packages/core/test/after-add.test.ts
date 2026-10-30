import { describe, expect, it } from "vitest";
import { stayPathAfterAdd } from "../src";

describe("staying on the page after Add to cart", () => {
  it("goes back to the store page the shopper added from, marked as added", () => {
    expect(stayPathAfterAdd("https://storefront.test/s/lamps/products/sunset", "/s/lamps")).toBe("/s/lamps/products/sunset?added=1");
    expect(stayPathAfterAdd("https://storefront.test/s/lamps/collections/all?sort=newest&added=1", "/s/lamps")).toBe("/s/lamps/collections/all?sort=newest&added=1");
    expect(stayPathAfterAdd("https://storefront.test/s/lamps", "/s/lamps")).toBe("/s/lamps?added=1");
    // On the store's own domain the base is empty.
    expect(stayPathAfterAdd("https://lamps.example.com/products/sunset", "")).toBe("/products/sunset?added=1");
  });

  it("opens the cart when there's no safe page to go back to", () => {
    expect(stayPathAfterAdd(null, "/s/lamps")).toBeNull();
    expect(stayPathAfterAdd("not a url", "/s/lamps")).toBeNull();
    expect(stayPathAfterAdd("https://storefront.test/s/other/products/x", "/s/lamps")).toBeNull();
    expect(stayPathAfterAdd("https://storefront.test/s/lampshades", "/s/lamps")).toBeNull();
    expect(stayPathAfterAdd("https://storefront.test//evil.example/x", "")).toBeNull();
    expect(stayPathAfterAdd("https://storefront.test/s/lamps/checkout", "/s/lamps")).toBeNull();
    expect(stayPathAfterAdd("https://lamps.example.com/pay/123", "")).toBeNull();
  });
});
