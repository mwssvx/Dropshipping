import { refreshAllVerified, routeStuckOrders, runFakePayouts, runHealthChecks, runScheduledAgents, sendAbandonedCartEmails, sendAllNotifications, syncTracking } from "@sf/core";
import { agents, fulfillment, pushSender, testPayments } from "@/lib/server";

/**
 * Scheduled job: place any paid orders that were missed, then pull tracking from suppliers.
 * Also checks store health and the verified badge, and in test mode stands in for the payment
 * processor's daily payouts. Buyers who left a checkout get one reminder. Then the AI agents look at problem orders and thin margins, and last
 * phones get push notifications for anything new.
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
  const reminders = await sendAbandonedCartEmails(ctx);
  const ai = await runScheduledAgents(await agents());
  const push = await sendAllNotifications({ db: ctx.db, push: pushSender() });
  return Response.json({ routed, tracking, payouts, health, verified, reminders, ai, push });
}
