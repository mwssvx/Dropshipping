import { describe, expect, it } from "vitest";
import { groupBy } from "../src/group";

describe("groupBy", () => {
  it("keeps rows in the order they came, under the row they belong to", () => {
    const rows = [
      { productId: "a", title: "S" },
      { productId: "b", title: "One size" },
      { productId: "a", title: "M" },
    ];
    const byProduct = groupBy(rows, (r) => r.productId);
    expect(byProduct.get("a")!.map((r) => r.title)).toEqual(["S", "M"]);
    expect(byProduct.get("b")!.map((r) => r.title)).toEqual(["One size"]);
    expect(byProduct.get("c")).toBeUndefined();
  });
});
