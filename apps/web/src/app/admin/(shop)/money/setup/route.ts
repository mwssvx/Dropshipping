import { redirect } from "next/navigation";
import { startPayoutSetup } from "@sf/core";
import { adminUrl, payments, requireShop } from "@/lib/server";

/** The provider's setup links expire; this hands out a fresh one (also its "refresh" address). */
export async function GET() {
  const { shop, user, db } = await requireShop("payouts");
  const url = await startPayoutSetup(db, payments(), shop, {
    email: user.email,
    returnUrl: await adminUrl("/admin/money/return"),
    refreshUrl: await adminUrl("/admin/money/setup"),
  });
  redirect(url);
}
