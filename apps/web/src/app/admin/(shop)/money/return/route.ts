import { redirect } from "next/navigation";
import { refreshPayoutAccount } from "@sf/core";
import { payments, requireShop } from "@/lib/server";

/** Where the payment provider sends the merchant after payout setup: read the new status, then show it. */
export async function GET() {
  const { shop, db } = await requireShop();
  await refreshPayoutAccount(db, payments(), shop);
  redirect("/admin/money?setup=done");
}
