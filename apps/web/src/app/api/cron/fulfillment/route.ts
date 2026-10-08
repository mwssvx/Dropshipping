import { routeStuckOrders, syncTracking } from "@sf/core";
import { fulfillment } from "@/lib/server";

/**
 * Scheduled job: place any paid orders that were missed, then pull tracking from suppliers.
 * Called by the scheduler with "Authorization: Bearer $CRON_SECRET". Open in development.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret ? request.headers.get("authorization") !== `Bearer ${secret}` : process.env.NODE_ENV === "production") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const ctx = await fulfillment();
  const routed = await routeStuckOrders(ctx);
  const tracking = await syncTracking(ctx, { limit: 200 });
  return Response.json({ routed, tracking });
}
