import { pruneActivity, pruneAuthRecords, pruneBuyerRecords, pruneStockAlerts, sendPriceDrops, sendStockAlerts, syncSupplierStock, pruneInvites, pruneEvents, refreshAllVerified, runWebhooks, routeStuckOrders, sendCampaignBatches, runFakePayouts, notifyNewDisputes, runDueSubscriptions, sendWinbackEmails, notifyCostChanges, notifyLatePreorders, runHealthChecks, runScheduledAgents, sendAbandonedCartEmails, sendAllNotifications, sendReferralRewards, syncTracking } from "@sf/core";
import { agents, campaigns, adminNotices, fulfillment, pushSender, stock, subscriptions, testPayments, webhooks } from "@/lib/server";

/**
 * Scheduled job: place any paid orders that were missed, then pull tracking from suppliers, and
 * stock and costs for products (buyers waiting on something back in stock get their email, and
 * buyers whose saved items got cheaper hear about it). Pre-orders back in stock are placed. Buyers whose referred friend's order
 * arrived get their store credit, and subscription deliveries that are due are placed and charged.
 * Also checks store health and the verified badge, and in test mode stands in for the payment
 * processor's daily payouts. Buyers who left a checkout get one reminder, and email campaigns go out in batches. Then the AI agents look at problem orders and thin margins, and last
 * phones get push notifications and webhooks go out for anything new. Old visitor events are pruned.
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
  // Refer a friend: credit for friends whose first order has now arrived.
  const referrals = await sendReferralRewards(await campaigns());
  const stockSync = await syncSupplierStock(ctx);
  // Supplier price rises that leave thin margins, or that raised prices on their own.
  const priceRises = await notifyCostChanges(await adminNotices());
  // Pre-orders whose stock just came back go to the supplier now; ones past their date get flagged.
  const preorders = { released: (await routeStuckOrders(ctx)).routed, late: (await notifyLatePreorders(await adminNotices())).sent };
  // Subscribe and save: "coming up" emails, then deliveries that are due, after stock is fresh.
  const repeats = await runDueSubscriptions(await subscriptions());
  const restocked = await sendStockAlerts(await stock());
  const priceDrops = await sendPriceDrops(await stock());
  const payouts = testPayments() ? await runFakePayouts(ctx.db) : null;
  // Disputes whose email didn't go out when the webhook came in.
  const disputes = await notifyNewDisputes(await adminNotices());
  // Store health warnings and the verified badge.
  const health = await runHealthChecks(ctx.db);
  const verified = await refreshAllVerified(ctx.db);
  const reminders = await sendAbandonedCartEmails(ctx);
  const campaignEmails = await sendCampaignBatches(await campaigns());
  // Win-back codes for subscribers who haven't ordered in a while.
  const winback = await sendWinbackEmails(await campaigns());
  const ai = await runScheduledAgents(await agents());
  const push = await sendAllNotifications({ db: ctx.db, push: pushSender() });
  const hooks = await runWebhooks(await webhooks());
  const pruned = await pruneEvents(ctx.db);
  await pruneAuthRecords(ctx.db);
  await pruneInvites(ctx.db);
  await pruneBuyerRecords(ctx.db);
  await pruneStockAlerts(ctx.db);
  await pruneActivity(ctx.db);
  return Response.json({ routed, tracking, referrals, stock: stockSync, priceRises, preorders, subscriptions: repeats, restocked, priceDrops, payouts, disputes, health, verified, reminders, campaigns: campaignEmails, winback, ai, push, webhooks: hooks, pruned });
}
