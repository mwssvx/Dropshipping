// Order risk check. A dropshipper pays the supplier as soon as an order is placed, so a stolen
// card costs them the goods, the shipping and a chargeback fee. Each paid order gets a quick
// check on signals we can see ourselves (no outside service), and the store can hold risky ones
// back from the supplier until someone looks.
import { and, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { schema, type Db, type OrderRisk, type RiskHold } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";

const DAY = 86_400_000;

/** Throwaway inbox services. Not exhaustive: one signal among several. */
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "sharklasers.com",
  "10minutemail.com",
  "temp-mail.org",
  "tempmail.com",
  "tempmailo.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "throwawaymail.com",
  "fakeinbox.com",
  "mohmal.com",
]);

const addressKey = (a: { line1: string; postalCode: string; country: string }) =>
  `${a.line1.toLowerCase().replace(/[^a-z0-9]/g, "")}|${a.postalCode.toLowerCase().replace(/\s/g, "")}|${a.country}`;

type Signal = { points: number; reason: string };

/**
 * Scores a paid order. Each signal adds points; 3 or more is high, 1–2 is medium. The reasons
 * are written for the merchant, so they can judge for themselves.
 */
export async function assessOrderRisk(db: Db, orderId: string, now = new Date()): Promise<OrderRisk> {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new NotFoundError("Order");
  const email = order.email.toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const signals: Signal[] = [];

  if (DISPOSABLE_DOMAINS.has(domain)) signals.push({ points: 2, reason: `The email is from a throwaway inbox service (${domain}).` });

  const [failed, sameEmailRecent, history, lines, nearby] = await Promise.all([
    // Several declined cards before one went through is the classic stolen-card pattern.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(and(eq(schema.orders.shopId, order.shopId), sql`lower(${schema.orders.email}) = ${email}`, eq(schema.orders.paymentStatus, "failed"), gte(schema.orders.createdAt, new Date(now.getTime() - DAY)))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.shopId, order.shopId),
          sql`lower(${schema.orders.email}) = ${email}`,
          ne(schema.orders.id, order.id),
          isNotNull(schema.orders.paidAt),
          gte(schema.orders.paidAt, new Date(now.getTime() - 3_600_000)),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int`, avg: sql<number>`coalesce(avg(${schema.orders.totalMinor}), 0)::int`, mine: sql<number>`count(*) filter (where lower(${schema.orders.email}) = ${email})::int` })
      .from(schema.orders)
      .where(and(eq(schema.orders.shopId, order.shopId), ne(schema.orders.id, order.id), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded", "refunded"]))),
    db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) }),
    db.query.orders.findMany({
      where: and(eq(schema.orders.shopId, order.shopId), ne(schema.orders.id, order.id), isNotNull(schema.orders.paidAt), gte(schema.orders.paidAt, new Date(now.getTime() - 30 * DAY))),
      columns: { email: true, shippingAddress: true },
      limit: 2000,
    }),
  ]);

  const failedCount = failed[0]?.n ?? 0;
  if (failedCount >= 2) signals.push({ points: 2, reason: `${failedCount} payments with this email were declined in the last day.` });

  const recent = sameEmailRecent[0]?.n ?? 0;
  if (recent >= 2) signals.push({ points: 1, reason: `This email paid for ${recent + 1} orders within an hour.` });

  // An address that people with different names and emails ship to is often a parcel forwarder.
  const key = addressKey(order.shippingAddress);
  const here = nearby.filter((o) => addressKey(o.shippingAddress) === key && o.email.toLowerCase() !== email);
  const names = new Set([order.shippingAddress.name, ...here.map((o) => o.shippingAddress.name)].map((n) => n.trim().toLowerCase()));
  const buyers = new Set(here.map((o) => o.email.toLowerCase())).size + 1;
  if (buyers >= 3 && names.size >= 3) signals.push({ points: 2, reason: `${buyers} different buyers shipped to this address in the last 30 days.` });

  const h = history[0] ?? { n: 0, avg: 0, mine: 0 };
  if (h.n >= 5 && order.totalMinor >= 10_000 && order.totalMinor >= h.avg * 5) {
    signals.push({ points: 1, reason: `The total is ${Math.round(order.totalMinor / Math.max(h.avg, 1))} times your average order (${formatMoney(h.avg, order.currency)}).` });
  } else if (h.mine === 0 && order.totalMinor >= 50_000) {
    signals.push({ points: 1, reason: `A first order from this buyer for ${formatMoney(order.totalMinor, order.currency)}.` });
  }

  // Wholesale buyers are approved by the merchant and order in bulk on purpose.
  const bulk = order.wholesale ? undefined : lines.find((l) => l.quantity >= 10);
  if (bulk) signals.push({ points: 1, reason: `Asks for ${bulk.quantity} of ${bulk.title}.` });

  const score = signals.reduce((s, x) => s + x.points, 0);
  return { level: score >= 3 ? "high" : score >= 1 ? "medium" : "low", score, reasons: signals.map((s) => s.reason), checkedAt: now.toISOString() };
}

/** Saves the check on the order and holds it when the store asks for that. Returns true when held. */
export async function checkOrderRisk(db: Db, orderId: string, now = new Date()) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new NotFoundError("Order");
  // Already checked (a retried webhook, the scheduled job): keep the first verdict.
  if (order.risk) return order.heldAt != null;
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, order.shopId) });
  const risk = await assessOrderRisk(db, orderId, now);
  const hold = shouldHold(shop?.holdRiskyOrders ?? "high", risk.level);
  await db
    .update(schema.orders)
    .set({ risk, heldAt: hold ? now : null, updatedAt: now })
    .where(eq(schema.orders.id, orderId));
  return hold;
}

export function shouldHold(setting: RiskHold, level: OrderRisk["level"]) {
  if (setting === "off" || level === "low") return false;
  return setting === "medium" || level === "high";
}

export async function setRiskHold(db: Db, shopId: string, value: string) {
  if (!["off", "medium", "high"].includes(value)) throw new UserError("Pick when to hold orders.");
  await db.update(schema.shops).set({ holdRiskyOrders: value as RiskHold, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}

export const RISK_HOLD_LABELS: Record<RiskHold, string> = {
  high: "Hold high-risk orders (recommended)",
  medium: "Hold medium- and high-risk orders",
  off: "Never hold orders",
};
