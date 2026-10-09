import { describe, expect, it } from "vitest";
import {
  addRedirect, addRedirects, changeProductHandle, createShop, deleteRedirect, DemoModel, exportStore, findRedirect, importStore, listRedirects, signUp, storePath,
} from "../src";
import { makeFixture } from "../evals/fixture";

describe("redirects", () => {
  it("cleans up pasted addresses", () => {
    expect(storePath("https://old-store.myshopify.com/products/Moon-Lamp/?variant=1#top")).toBe("/products/moon-lamp");
    expect(storePath("collections//summer/")).toBe("/collections/summer");
    expect(() => storePath("/two words")).toThrow("spaces");
  });

  it("adds, uses and removes redirects, one at a time or pasted", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const r = await addRedirect(f.db, shop.id, { from: "https://old.example.com/products/sunset-lamp", to: `/products/${f.products.lamp.handle}` });
    expect(r).toMatchObject({ fromPath: "/products/sunset-lamp", toPath: `/products/${f.products.lamp.handle}` });
    await expect(addRedirect(f.db, shop.id, { from: "/products/sunset-lamp", to: "/" })).rejects.toThrow("already a redirect");
    await expect(addRedirect(f.db, shop.id, { from: "/", to: "/products/x" })).rejects.toThrow("home page");
    await expect(addRedirect(f.db, shop.id, { from: "/cart", to: "/products/x" })).rejects.toThrow("can't be redirected");
    await expect(addRedirect(f.db, shop.id, { from: "/a", to: "/a" })).rejects.toThrow("itself");
    await expect(addRedirect(f.db, shop.id, { from: "/a", to: "http://insecure.example.com" })).rejects.toThrow("https");

    expect(await findRedirect(f.db, shop.id, "/Products/Sunset-Lamp/")).toBe(`/products/${f.products.lamp.handle}`);
    expect(await findRedirect(f.db, shop.id, "/products/nothing")).toBeNull();
    expect(await findRedirect(f.db, "00000000-0000-0000-0000-000000000000", "/products/sunset-lamp")).toBeNull();
    expect((await listRedirects(f.db, shop.id))[0]).toMatchObject({ hits: 1 });

    const pasted = await addRedirects(f.db, shop.id, [
      "Redirect from,Redirect to",
      "/pages/about-us, /pages/about",
      "/blogs/news\thttps://blog.example.com/news",
      "/cart /",
      "just-one-address",
    ].join("\n"));
    expect(pasted.added).toBe(2);
    expect(pasted.skipped.map((s) => s.line)).toEqual(["/cart /", "just-one-address"]);
    expect(await findRedirect(f.db, shop.id, "/blogs/news")).toBe("https://blog.example.com/news");

    await deleteRedirect(f.db, shop.id, r.id);
    await expect(deleteRedirect(f.db, shop.id, r.id)).rejects.toThrow("not found");
    expect(await listRedirects(f.db, shop.id)).toHaveLength(2);
  });

  it("renaming a product keeps its old address working, without chains", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const old = f.products.lamp.handle;
    await addRedirect(f.db, shop.id, { from: "/products/from-old-store", to: `/products/${old}` });
    await addRedirect(f.db, shop.id, { from: "/products/glow-lamp", to: "/" });

    expect((await changeProductHandle(f.db, shop.id, f.products.lamp.id, " Glow Lamp ")).handle).toBe("glow-lamp");
    expect(await findRedirect(f.db, shop.id, `/products/${old}`)).toBe("/products/glow-lamp");
    expect(await findRedirect(f.db, shop.id, "/products/from-old-store")).toBe("/products/glow-lamp");
    // The new address is a real product now, so the redirect that was there is gone.
    expect((await listRedirects(f.db, shop.id)).map((r) => r.fromPath)).not.toContain("/products/glow-lamp");

    // And back again: the address it had before is a product page again.
    await changeProductHandle(f.db, shop.id, f.products.lamp.id, `https://shop.example.com/products/${old}`);
    expect((await listRedirects(f.db, shop.id)).map((r) => [r.fromPath, r.toPath])).toEqual([
      ["/products/from-old-store", `/products/${old}`],
      ["/products/glow-lamp", `/products/${old}`],
    ]);

    await expect(changeProductHandle(f.db, shop.id, f.products.lamp.id, f.products.stand.handle)).rejects.toThrow("Another product");
    await expect(changeProductHandle(f.db, shop.id, f.products.lamp.id, "!!!")).rejects.toThrow("letters and numbers");

    // Redirects travel in the store file.
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    const result = await importStore(f.db, copy.id, JSON.parse(JSON.stringify(await exportStore(f.db, shop.id))));
    expect(result.redirects).toBe(2);
    expect(await findRedirect(f.db, copy.id, "/products/glow-lamp")).toBe(`/products/${old}`);
  });
});
