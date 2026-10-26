"use server";
import { revalidatePath } from "next/cache";
import { createPartner, formatMoney, parseMoney, recordPartnerPayout, resetPartnerLink, setPartnerActive, UserError } from "@sf/core";
import { logged, mailer, partnerPortalUrl, requireShop, storeAddress } from "@/lib/server";

export type PartnerState = { error?: string; added?: string };

/** Adds a partner with their own code; they're emailed it when an email is given. */
export async function createPartnerAction(_: PartnerState, form: FormData): Promise<PartnerState> {
  const { shop, db, user } = await requireShop("marketing");
  const store = await storeAddress(shop);
  try {
    const partner = await createPartner({ db, mailer: mailer(), partnerUrl: partnerPortalUrl, storeUrl: () => store }, shop, {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      code: String(form.get("code") ?? ""),
      percentOff: Number.parseInt(String(form.get("percentOff") ?? ""), 10) || 0,
      commissionPercent: Number.parseFloat(String(form.get("commission") ?? "")) || 0,
    });
    await logged({ shop, user, db }, `Added partner ${partner.name} with the code ${partner.code}`, { href: "/admin/partners" });
    revalidatePath("/admin/partners");
    return { added: partner.name };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function setPartnerActiveAction(id: string, active: boolean) {
  const { shop, db, user } = await requireShop("marketing");
  const partner = await setPartnerActive(db, shop.id, id, active);
  await logged({ shop, user, db }, `${active ? "Brought back" : "Paused"} partner ${partner.name}`, { href: "/admin/partners" });
  revalidatePath("/admin/partners");
}

export async function resetPartnerLinkAction(id: string) {
  const { shop, db, user } = await requireShop("marketing");
  const partner = await resetPartnerLink(db, shop.id, id);
  await logged({ shop, user, db }, `Made a new private link for partner ${partner.name}`, { href: "/admin/partners" });
  revalidatePath("/admin/partners");
}

export type PayoutState = { error?: string; saved?: string };

/** Records what the merchant paid a partner. Money, so only those who see the store's money. */
export async function partnerPayoutAction(id: string, _: PayoutState, form: FormData): Promise<PayoutState> {
  const { shop, db, user } = await requireShop("money");
  let amountMinor: number;
  try {
    amountMinor = parseMoney(String(form.get("amount") ?? ""));
  } catch {
    return { error: "Enter the amount, like 25.00." };
  }
  try {
    const { partner, payout } = await recordPartnerPayout(db, shop, id, { amountMinor, note: String(form.get("note") ?? "") });
    const amount = formatMoney(payout.amountMinor, shop.currency);
    await logged({ shop, user, db }, `Recorded ${amount} paid to partner ${partner.name}`, { href: "/admin/partners" });
    revalidatePath("/admin/partners");
    return { saved: `Recorded ${amount} paid to ${partner.name}.` };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
