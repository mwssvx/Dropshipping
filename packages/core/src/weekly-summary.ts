// The Monday summary: one email to the people who can see a store's money, covering last week
// (Monday to Sunday, UTC) against the week before, the best sellers, profit, and what's waiting for
// them. Sent once per store per week from the daily job; quiet stores with nothing to say get none.
// Each person can turn it off for each store on their account page.
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import type { Shop } from "./ai/context";
import { analyticsReport } from "./analytics";
import type { Mailer } from "./email";
import { formatMoney } from "./money";
import { todaySummary } from "./mobile/today";
import { profitReport } from "./profit";
import { can } from "./team";

const DAY = 86_400_000;

/** Last full week, Monday 00:00 to the next Monday 00:00 (UTC), and the one before it. */
export function summaryWeek(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const to = new Date(today - sinceMonday * DAY);
  const from = new Date(to.getTime() - 7 * DAY);
  return { from, to, before: { from: new Date(from.getTime() - 7 * DAY), to: from }, key: from.toISOString().slice(0, 10) };
}

/** Change against the week before, as a whole percent; null when there's nothing to compare with. */
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export async function weeklySummary(db: Db, shop: Shop, now = new Date()) {
  const week = summaryWeek(now);
  const [last, before, profit, today] = await Promise.all([
    analyticsReport(db, shop.id, week),
    analyticsReport(db, shop.id, week.before),
    // The profit report counts whole days up to and including its last one: Sunday.
    profitReport(db, shop, 7, new Date(week.to.getTime() - 1)),
    todaySummary(db, shop, now, "owner"),
  ]);
  // Orders on their way to the supplier go on their own, so they aren't something to do.
  const waiting = today.attention.filter((a) => a.kind !== "to_send");
  return {
    week,
    salesMinor: last.salesMinor,
    orders: last.orders,
    averageOrderMinor: last.averageOrderMinor,
    visitors: last.visitors,
    conversion: last.conversion,
    salesChange: change(last.salesMinor, before.salesMinor),
    ordersChange: change(last.orders, before.orders),
    top: last.topProducts.slice(0, 3),
    profitMinor: profit.totals.profitMinor,
    profitIncomplete: profit.totals.costMissing,
    waiting,
    approvals: today.pending.length,
    quiet: last.orders === 0 && before.orders === 0 && waiting.length === 0 && today.pending.length === 0,
  };
}

export type WeeklySummary = Awaited<ReturnType<typeof weeklySummary>>;

const dayName = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const versus = (pct: number | null) => (pct === null ? "" : pct === 0 ? " (same as the week before)" : ` (${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% on the week before)`);

export function weeklySummaryEmail(s: WeeklySummary, shop: Pick<Shop, "name" | "currency">, adminUrl: (path: string) => string) {
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const lastDay = new Date(s.week.to.getTime() - DAY);
  const lines = [
    `Hi,`,
    ``,
    `Here's how ${shop.name} did from ${dayName(s.week.from)} to ${dayName(lastDay)}.`,
    ``,
    `Sales: ${money(s.salesMinor)}${versus(s.salesChange)}`,
    `Orders: ${s.orders}${versus(s.ordersChange)}`,
  ];
  if (s.orders) lines.push(`Average order: ${money(s.averageOrderMinor)}`);
  lines.push(`Visitors: ${s.visitors}${s.conversion !== null ? `, and ${(s.conversion * 100).toFixed(1)}% of them ordered` : ""}`);
  if (s.orders) lines.push(`Profit after supplier costs, fees and ads: ${money(s.profitMinor)}${s.profitIncomplete ? " (some products have no cost yet, so it's higher than it really is)" : ""}`);
  if (s.top.length) {
    lines.push(``, `Best sellers:`);
    for (const p of s.top) lines.push(`- ${p.title}: ${p.units} sold, ${money(p.salesMinor)}`);
  }
  const todo = [...s.waiting.map((w) => `- ${w.title}. ${w.body}`)];
  if (s.approvals) todo.push(`- ${s.approvals === 1 ? "1 change waits" : `${s.approvals} changes wait`} for your OK on the Assistant page.`);
  lines.push(``, todo.length ? `Waiting for you:` : `Nothing is waiting for you.`, ...todo);
  lines.push(``, `Your numbers in full: ${adminUrl("/admin/analytics")}`, ``, `You get this every Monday. To stop it, turn it off under Your account: ${adminUrl("/admin/account")}`);
  const subject = `${shop.name} last week: ${money(s.salesMinor)} from ${s.orders} ${s.orders === 1 ? "order" : "orders"}`;
  return { subject, text: lines.join("\n") };
}

/**
 * Once a week, from the daily job: each store not yet summed up for last week gets its summary,
 * sent to every member who can see its money and hasn't turned it off. Claimed before sending, so
 * two runs can't send it twice.
 */
export async function sendWeeklySummaries(ctx: { db: Db; mailer: Mailer; adminUrl: (path: string) => string }, opts: { shopId?: string; now?: Date } = {}) {
  const { db } = ctx;
  const now = opts.now ?? new Date();
  const { key, to } = summaryWeek(now);
  const due = await db.query.shops.findMany({
    where: and(opts.shopId ? eq(schema.shops.id, opts.shopId) : undefined, or(isNull(schema.shops.weeklySummaryFor), ne(schema.shops.weeklySummaryFor, key))),
    limit: 200,
  });
  let sent = 0;
  for (const shop of due) {
    const [claimed] = await db
      .update(schema.shops)
      .set({ weeklySummaryFor: key })
      .where(and(eq(schema.shops.id, shop.id), or(isNull(schema.shops.weeklySummaryFor), ne(schema.shops.weeklySummaryFor, key))))
      .returning({ id: schema.shops.id });
    // A store opened after the week ended has nothing to look back on yet.
    if (!claimed || shop.createdAt >= to) continue;
    const people = await db
      .select({ email: schema.users.email, role: schema.shopMembers.role, on: schema.shopMembers.weeklySummary })
      .from(schema.shopMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
      .where(eq(schema.shopMembers.shopId, shop.id));
    const readers = people.filter((p) => p.on && can(p.role, "money"));
    if (!readers.length) continue;
    const summary = await weeklySummary(db, shop, now);
    if (summary.quiet) continue;
    const email = weeklySummaryEmail(summary, shop, ctx.adminUrl);
    for (const p of readers) {
      await ctx.mailer.send({ to: p.email, ...email });
      sent++;
    }
  }
  return { sent };
}

/** Turns one person's Monday summary of one store on or off. */
export async function setWeeklySummary(db: Db, shopId: string, userId: string, on: boolean) {
  await db.update(schema.shopMembers).set({ weeklySummary: on }).where(and(eq(schema.shopMembers.shopId, shopId), eq(schema.shopMembers.userId, userId)));
}
