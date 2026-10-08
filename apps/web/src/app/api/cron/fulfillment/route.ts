import { refreshAllVerified, routeStuckOrders, runFakePayouts, runHealthChecks, syncTracking } from "@sf/core";
import { fulfillment, testPayments } from "@/lib/server";

/**
 * Scheduled job: place any paid orders that were missed, then pull tracking from suppliers.
 * Also checks store health and the verified badge, and in test mode stands in for the payment
 * processor's daily payouts.
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
  const payouts = testPayments() ? await runFakePayouts(ctx.db) : null;
  // Store health warnings and the verified badge.
  const health = await runHealthChecks(ctx.db);
  const verified = await refreshAllVerified(ctx.db);
  return Response.json({ routed, tracking, payouts, health, verified });
}
