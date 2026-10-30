import Link from "next/link";
import { redirect } from "next/navigation";
import { currentDailyDeal, defaultCutoffZone } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeBase } from "../data";

export const metadata = { title: "Deal of the day" };
export const dynamic = "force-dynamic";

/**
 * The one link a store shares for a run of daily deals: it goes to the product that's on today.
 * Between deals it says when the next one starts, so the link never dead-ends.
 */
export default async function DealPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const { today, next } = await currentDailyDeal(await db(), shop.id);
  if (today) redirect(`${base}/products/${today.product.handle}`);
  const zone = shop.shipCutoff?.timeZone ?? defaultCutoffZone(shop.country);
  const starts = next?.startsAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone });
  return (
    <main className="max-w-lg mx-auto px-4 sm:px-6 py-12 flex flex-col gap-4">
      <h1 className="text-3xl font-bold tracking-tight">Deal of the day</h1>
      <p className="text-muted">{next ? `There's no deal on right now. The next one starts on ${starts}: come back then, it's only on for the day.` : "There's no deal on right now."}</p>
      <Link href={base || "/"} className="btn btn-primary self-start">Shop everything</Link>
    </main>
  );
}
