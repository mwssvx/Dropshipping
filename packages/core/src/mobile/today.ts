import { and, eq, gte, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { countNeedsYou } from "../ai/conversations";
import { listPendingActions } from "../ai/runtime";
import { listRequirements } from "../payouts";
import { soldOutAtSupplier } from "../supplier-sold-out";
import { openNotices } from "../trust";
import type { Shop } from "../ai/context";
import { can, type Role } from "../team";

export type AttentionItem = { kind: "hold" | "notice" | "problems" | "risk" | "to_send" | "inbox" | "sold_out"; title: string; body: string; url: string; tone: "critical" | "warning" | "info" };

const DAY = 86_400_000;

/** The app's first screen: today's numbers, what needs the merchant, and what waits for their OK. */
export async function todaySummary(db: Db, shop: Shop, now = new Date(), role: Role = "owner") {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const [recent, open, requirements, notices, pending, inbox, soldOut] = await Promise.all([
    db.query.orders.findMany({
      where: and(eq(schema.orders.shopId, shop.id), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded", "refunded"]), gte(schema.orders.paidAt, weekAgo)),
    }),
    db.query.orders.findMany({
      where: and(eq(schema.orders.shopId, shop.id), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"]), inArray(schema.orders.fulfillmentStatus, ["unfulfilled", "problem"])),
      columns: { id: true, fulfillmentStatus: true, heldAt: true },
    }),
    listRequirements(db, shop.id),
    openNotices(db, shop.id),
    listPendingActions(db, shop.id),
    countNeedsYou(db, shop.id),
    can(role, "products") ? soldOutAtSupplier(db, shop.id, now) : [],
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
  const held = open.filter((o) => o.heldAt && o.fulfillmentStatus === "unfulfilled").length;
  if (held) attention.push({ kind: "risk", tone: "warning", title: `${held} ${held === 1 ? "order" : "orders"} on hold`, body: held === 1 ? "It looked risky, so it waits for you before going to the supplier." : "They looked risky, so they wait for you before going to the supplier.", url: "/orders?show=held" });
  const toSend = open.length - problems - held;
  if (toSend) attention.push({ kind: "to_send", tone: "info", title: `${toSend} ${toSend === 1 ? "order" : "orders"} on the way to the supplier`, body: "These are sent automatically.", url: "/orders?show=to_send" });
  if (inbox) attention.push({ kind: "inbox", tone: "warning", title: `${inbox} buyer ${inbox === 1 ? "question needs" : "questions need"} you`, body: "Open the inbox to answer them.", url: "/inbox" });
  if (soldOut.length)
    attention.push({
      kind: "sold_out",
      tone: "warning",
      title: soldOut.length === 1 ? `${soldOut[0]!.title} sold out at the supplier` : `${soldOut.length} products sold out at the supplier`,
      body: "Buyers can't order them until the supplier restocks. Add a backup supplier, or take them off sale.",
      url: "/products#supplier-sold-out",
    });

  // Staff see order counts and order problems, not sales totals, payouts or AI proposals.
  const seesMoney = can(role, "money");
  const ATTENTION_AREA = { hold: "money", notice: "trust", problems: "orders", risk: "orders", to_send: "orders", inbox: "inbox", sold_out: "products" } as const;
  return {
    currency: shop.currency,
    salesTodayMinor: seesMoney ? today.reduce((s, o) => s + net(o), 0) : null,
    ordersToday: today.length,
    sales7dMinor: seesMoney ? recent.reduce((s, o) => s + net(o), 0) : null,
    orders7d: recent.length,
    attention: attention.filter((a) => can(role, ATTENTION_AREA[a.kind])),
    pending: can(role, "assistant") ? pending : [],
  };
}
