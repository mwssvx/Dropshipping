import { and, eq, gte, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { countNeedsYou } from "../ai/conversations";
import { listPendingActions } from "../ai/runtime";
import { listRequirements } from "../payouts";
import { openNotices } from "../trust";
import type { Shop } from "../ai/context";

export type AttentionItem = { kind: "hold" | "notice" | "problems" | "to_send" | "inbox"; title: string; body: string; url: string; tone: "critical" | "warning" | "info" };

const DAY = 86_400_000;

/** The app's first screen: today's numbers, what needs the merchant, and what waits for their OK. */
export async function todaySummary(db: Db, shop: Shop, now = new Date()) {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const [recent, open, requirements, notices, pending, inbox] = await Promise.all([
    db.query.orders.findMany({
      where: and(eq(schema.orders.shopId, shop.id), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded", "refunded"]), gte(schema.orders.paidAt, weekAgo)),
    }),
    db.query.orders.findMany({
      where: and(eq(schema.orders.shopId, shop.id), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"]), inArray(schema.orders.fulfillmentStatus, ["unfulfilled", "problem"])),
      columns: { id: true, fulfillmentStatus: true },
    }),
    listRequirements(db, shop.id),
    openNotices(db, shop.id),
    listPendingActions(db, shop.id),
    countNeedsYou(db, shop.id),
  ]);
  const net = (o: (typeof recent)[number]) => o.totalMinor - o.refundedMinor;
  const today = recent.filter((o) => o.paidAt! >= startOfDay);

  const attention: AttentionItem[] = [];
  const holds = requirements.filter((r) => r.holdsPayouts && !r.submittedAt);
  if (holds.length) {
    attention.push({ kind: "hold", tone: "critical", title: "Payouts are paused", body: `Send: ${holds.map((h) => h.title.toLowerCase()).join(", ")}.`, url: "/money" });
  }
  for (const n of notices) {
    if (n.kind === "reinstated") continue;
    attention.push({ kind: "notice", tone: n.kind === "warning" ? "warning" : "critical", title: n.kind === "warning" ? "A warning from us" : "Your store is paused", body: n.explanation, url: "/notices" });
  }
  const problems = open.filter((o) => o.fulfillmentStatus === "problem").length;
  if (problems) attention.push({ kind: "problems", tone: "critical", title: `${problems} ${problems === 1 ? "order needs" : "orders need"} you`, body: problems === 1 ? "The supplier couldn't take it. Open it to see the fix." : "The supplier couldn't take them. Each one has a fix.", url: "/orders?show=problems" });
  const toSend = open.length - problems;
  if (toSend) attention.push({ kind: "to_send", tone: "info", title: `${toSend} ${toSend === 1 ? "order" : "orders"} on the way to the supplier`, body: "These are sent automatically.", url: "/orders?show=to_send" });
  if (inbox) attention.push({ kind: "inbox", tone: "warning", title: `${inbox} buyer ${inbox === 1 ? "question needs" : "questions need"} you`, body: "Open the inbox on the web admin to answer.", url: "/inbox" });

  return {
    currency: shop.currency,
    salesTodayMinor: today.reduce((s, o) => s + net(o), 0),
    ordersToday: today.length,
    sales7dMinor: recent.reduce((s, o) => s + net(o), 0),
    orders7d: recent.length,
    attention,
    pending,
  };
}
