import { cookies } from "next/headers";
import { recordCampaignClick } from "@sf/core";
import { campaignCookie } from "@/lib/campaigns";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../../data";

/** The button in a campaign email: counts the click, remembers it for a week, then opens the store. */
export async function GET(_request: Request, { params }: { params: Promise<{ shop: string; sendId: string }> }) {
  const { shop: handle, sendId } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const click = await recordCampaignClick(await db(), shop.id, sendId);
  if (click) {
    (await cookies()).set(campaignCookie(shop.id), click.campaignId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 7 * 86_400 });
  }
  // A relative Location keeps the buyer on the address they came in on (store subdomain or custom domain).
  return new Response(null, { status: 303, headers: { Location: `${base}${click?.path ?? "/"}` } });
}
