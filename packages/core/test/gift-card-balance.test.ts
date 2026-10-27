import { describe, expect, it } from "vitest";
import { DemoModel, giftCardBalance, issueGiftCard, setGiftCardDisabled } from "../src";
import { makeFixture } from "../evals/fixture";

describe("gift card balance", () => {
  it("shows what's left for the right code only", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const issued = await issueGiftCard({ db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" }, shop, { email: "friend@example.com", amountMinor: 2500 });
    const code = issued.code;

    expect(await giftCardBalance(f.db, shop.id, code.toLowerCase().replace(/-/g, " "))).toEqual({
      last4: code.replace(/-/g, "").slice(-4), currency: shop.currency, initialMinor: 2500, balanceMinor: 2500, status: "ok",
    });
    expect(await giftCardBalance(f.db, shop.id, "AAAA-BBBB-CCCC-DDDD")).toBeNull();
    expect(await giftCardBalance(f.db, shop.id, "nope")).toBeNull();
    await setGiftCardDisabled(f.db, shop.id, issued.card.id, true);
    expect((await giftCardBalance(f.db, shop.id, code))!.status).toBe("off");
  });
});
