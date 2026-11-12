import { describe, expect, it } from "vitest";
import { PAYOUT_GUIDE_NOTES, PAYOUT_RULES, payoutGuide } from "../src";

describe("payout guide", () => {
  it("says what to have ready, with the EIN option for US sellers", () => {
    const us = payoutGuide("US");
    expect(us.ready.join(" ")).toContain("No shop, office or warehouse is needed");
    expect(us.taxId).toContain("last 4 digits of your Social Security number");
    expect(us.taxId).toContain("free EIN");
    expect(us.bank).toContain("US bank account");
    expect(payoutGuide("GB")).toMatchObject({ taxId: null, bank: expect.stringContaining("sort code") });
    expect(payoutGuide("CA").bank).toContain("Canadian");
    expect(payoutGuide("DE").bank).toContain("IBAN");
  });

  it("promises we never see the numbers, and lists the payout rules", () => {
    expect(PAYOUT_GUIDE_NOTES.join(" ")).toContain("We never see or store your ID or tax numbers.");
    expect(PAYOUT_RULES.map((s) => s.heading)).toEqual(["When your money arrives", "What can pause payouts", "What we promise", "How to never see a pause"]);
  });
});
