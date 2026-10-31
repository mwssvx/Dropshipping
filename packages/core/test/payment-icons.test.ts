import { describe, expect, it } from "vitest";
import { paymentMethods } from "../src";
import { defaultTheme, parseTheme } from "../src/theme-doc";

describe("ways to pay in the footer", () => {
  it("lists cards and wallets, and bank transfers only when the store takes them on a paid plan", () => {
    const transfer = { details: "IBAN DE00 0000", days: 7 };
    expect(paymentMethods({ bankTransfer: null, plan: "free" })).toEqual(["visa", "mastercard", "amex", "apple_pay", "google_pay"]);
    expect(paymentMethods({ bankTransfer: transfer, plan: "free" })).not.toContain("bank_transfer");
    expect(paymentMethods({ bankTransfer: transfer, plan: "growth" }).at(-1)).toBe("bank_transfer");
  });

  it("are shown unless the theme turns them off, also for stores saved before they existed", () => {
    const old = defaultTheme("Shop") as { settings: Record<string, unknown> };
    delete old.settings.paymentIcons;
    expect(parseTheme(old).settings.paymentIcons).toBe(true);
    expect(parseTheme({ ...defaultTheme("Shop"), settings: { ...defaultTheme("Shop").settings, paymentIcons: false } }).settings.paymentIcons).toBe(false);
  });
});
