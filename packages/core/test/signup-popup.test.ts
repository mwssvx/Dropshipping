import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createShop, DemoModel, exportStore, importStore, setSignupPopup, signUp, signupPopupAllowed, SIGNUP_POPUP_ON_LEAVE } from "../src";
import { makeFixture } from "../evals/fixture";

describe("sign-up pop-up", () => {
  it("opens after a few seconds, never on buying or account pages", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await expect(setSignupPopup(f.db, shopId, 10)).rejects.toThrow("about to leave, or after 5, 15, 30 or 60 seconds");
    expect(await setSignupPopup(f.db, shopId, 15)).toBe(15);
    expect((await f.shop()).signupPopupSeconds).toBe(15);

    for (const path of ["/", "/products/lamp", "/collections/summer", "/de", "/de/products/lamp", "/search", "/pages/about", "/blog/hello"]) expect(signupPopupAllowed(path), path).toBe(true);
    for (const path of ["/cart", "/de/cart", "/checkout/abc", "/pay/abc", "/account", "/orders/abc", "/subscribe/tok", "/unsubscribe/tok", "/password", "/discount/SAVE10", "/r/ADA", "/refer/ADA", "/saved/tok", "/track"]) expect(signupPopupAllowed(path), path).toBe(false);

    // Store files carry it.
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shopId)));
    expect(file.store.signup_popup_seconds).toBe(15);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!.signupPopupSeconds).toBe(15);

    // "When a visitor is about to leave" is stored as 0 and travels in store files too.
    expect(await setSignupPopup(f.db, shopId, SIGNUP_POPUP_ON_LEAVE)).toBe(0);
    const leaving = JSON.parse(JSON.stringify(await exportStore(f.db, shopId)));
    expect(leaving.store.signup_popup_seconds).toBe(0);
    const second = await createShop(f.db, user.id, { name: "Second copy", country: "US" });
    await importStore(f.db, second.id, leaving);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, second.id) }))!.signupPopupSeconds).toBe(0);

    await setSignupPopup(f.db, shopId, null);
    expect((await f.shop()).signupPopupSeconds).toBeNull();
  });
});
