// "What the AI did for you": a month of the helpers' work in plain numbers (buyer replies, shopper
// answers, changes made, reports written), a rough guess at the time that saved, and what it cost.
// Read straight from the logs, so it costs nothing to show. Emailed once a month to the people who
// can see the store's money, unless the owner turns it off.
import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import type { Mailer } from "../email";
import { formatMoney } from "../money";
import { can } from "../team";
import type { Shop } from "./context";
import { findTool } from "./tools";

/**
 * Minutes a person would roughly spend doing each thing by hand. Kept low on purpose: the point
 * is an honest floor, not a sales pitch.
 */
export const MINUTES_SAVED = { replyOnItsOwn: 5, replyDrafted: 3, shopperAnswer: 2, change: 4, report: 30, alert: 10 } as const;

/** A calendar month in UTC; `back` 0 is this month so far, 1 is last month. */
export function aiMonth(now = new Date(), back = 0) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1));
  return {
    from,
    to: back === 0 ? now : end,
    key: from.toISOString().slice(0, 7),
    label: from.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

const NOT_CHANGES = new Set<string>(["reply_checker", "watch", "analyst", "scout"]);
const count = sql<number>`count(*)::int`;

export async function aiImpact(db: Db, shopId: string, month: { from: Date; to: Date }) {
  const inMonth = (t: { createdAt: Parameters<typeof gte>[0] }) => [gte(t.createdAt, month.from), lt(t.createdAt, month.to)];
  const [actions, agentMessages, runs, reports] = await Promise.all([
    db
      .select({ agent: schema.agentActions.agent, tool: schema.agentActions.tool, status: schema.agentActions.status, n: count })
      .from(schema.agentActions)
      .where(and(eq(schema.agentActions.shopId, shopId), ...inMonth(schema.agentActions)))
      .groupBy(schema.agentActions.agent, schema.agentActions.tool, schema.agentActions.status),
    db
      .select({ kind: schema.conversations.kind, n: count, chats: sql<number>`count(distinct ${schema.messages.conversationId})::int` })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(and(eq(schema.conversations.shopId, shopId), eq(schema.messages.author, "agent"), inArray(schema.conversations.kind, ["buyer", "shopper"]), ...inMonth(schema.messages)))
      .groupBy(schema.conversations.kind),
    db
      .select({ micros: sql<number>`coalesce(sum(${schema.agentRuns.costMicros}), 0)::bigint`, n: count })
      .from(schema.agentRuns)
      .where(and(eq(schema.agentRuns.shopId, shopId), ...inMonth(schema.agentRuns))),
    db
      .select({ kind: schema.aiReports.kind, n: count })
      .from(schema.aiReports)
      .where(and(eq(schema.aiReports.shopId, shopId), ...inMonth(schema.aiReports)))
      .groupBy(schema.aiReports.kind),
  ]);

  const sum = (rows: { n: number }[]) => rows.reduce((s, r) => s + Number(r.n), 0);
  const buyer = agentMessages.find((m) => m.kind === "buyer");
  const shopper = agentMessages.find((m) => m.kind === "shopper");
  const repliesOnItsOwn = sum(actions.filter((a) => a.agent === "buyer_support" && a.tool === "send_reply" && a.status === "done"));
  // Every other reply it wrote waited for the owner: sent as it was, edited, or replaced.
  const repliesDrafted = Math.max(0, Number(buyer?.n ?? 0) - repliesOnItsOwn);
  // Changes it carried out, by itself or once the owner said yes. Replies and reports are counted
  // on their own, and the reply checker's verdicts are its own bookkeeping.
  const isChange = (a: (typeof actions)[number]) => !NOT_CHANGES.has(a.agent) && a.tool !== "send_reply" && findTool(a.agent, a.tool)?.kind === "change";
  const changes = actions.filter((a) => isChange(a) && (a.status === "done" || a.status === "approved"));
  const byHelper: Partial<Record<string, number>> = {};
  for (const c of changes) byHelper[c.agent] = (byHelper[c.agent] ?? 0) + Number(c.n);
  const reportCount = sum(reports.filter((r) => r.kind !== "watch"));
  const alerts = sum(reports.filter((r) => r.kind === "watch"));

  const counts = {
    repliesOnItsOwn,
    repliesDrafted,
    shopperAnswers: Number(shopper?.n ?? 0),
    shopperChats: Number(shopper?.chats ?? 0),
    changes: sum(changes),
    reports: reportCount,
    alerts,
  };
  const minutes =
    counts.repliesOnItsOwn * MINUTES_SAVED.replyOnItsOwn +
    counts.repliesDrafted * MINUTES_SAVED.replyDrafted +
    counts.shopperAnswers * MINUTES_SAVED.shopperAnswer +
    counts.changes * MINUTES_SAVED.change +
    counts.reports * MINUTES_SAVED.report +
    counts.alerts * MINUTES_SAVED.alert;
  const costMicros = Number(runs[0]?.micros ?? 0);
  return {
    ...counts,
    byHelper,
    /** Things it proposed that the owner turned down, and things its rules stopped. */
    turnedDown: sum(actions.filter((a) => isChange(a) && a.status === "rejected")),
    stopped: sum(actions.filter((a) => a.status === "blocked")),
    waiting: sum(actions.filter((a) => a.status === "pending")),
    runs: Number(runs[0]?.n ?? 0),
    minutesSaved: minutes,
    costMicros,
    /** Whole cents, rounded up, like the budget. */
    costMinor: Math.ceil(costMicros / 10_000),
  };
}

export type AiImpact = Awaited<ReturnType<typeof aiImpact>>;

/** "About 3 hours", "About 40 minutes". */
export function timeSaved(minutes: number) {
  if (minutes < 60) return `About ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 30) / 2;
  return `About ${hours} hour${hours === 1 ? "" : "s"}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line per kind of work it did, skipping the ones it didn't. */
export function impactLines(i: AiImpact) {
  const lines: string[] = [];
  if (i.repliesOnItsOwn) lines.push(`Answered ${plural(i.repliesOnItsOwn, "buyer question")} on its own`);
  if (i.repliesDrafted) lines.push(`Drafted ${plural(i.repliesDrafted, "reply", "replies")} to buyers for you to check`);
  if (i.shopperAnswers) lines.push(`Answered ${plural(i.shopperAnswers, "shopper question")} in ${plural(i.shopperChats, "chat")} on your store`);
  if (i.changes) lines.push(`Made ${plural(i.changes, "change")} to your store (listings, translations, settings and more)`);
  if (i.reports) lines.push(`Wrote ${plural(i.reports, "report")} on your store and trending products`);
  if (i.alerts) lines.push(`Spotted ${plural(i.alerts, "day")} when something moved out of line`);
  return lines;
}

export function aiImpactEmail(i: AiImpact, shop: Pick<Shop, "name">, month: { label: string }, adminUrl: (path: string) => string) {
  const text = [
    "Hi,",
    "",
    `Here's what the AI helpers did for ${shop.name} in ${month.label}.`,
    "",
    ...impactLines(i).map((l) => `- ${l}`),
    "",
    `Time saved: ${timeSaved(i.minutesSaved).toLowerCase()}, a rough guess at doing it all by hand.`,
    `AI cost: ${formatMoney(i.costMinor, "USD")}${i.costMinor ? "" : " (nothing)"}, from your plan's AI budget.`,
    ...(i.turnedDown ? [`You turned down ${plural(i.turnedDown, "suggestion")}, and nothing changed for those.`] : []),
    ...(i.waiting ? [`${plural(i.waiting, "thing")} still ${i.waiting === 1 ? "waits" : "wait"} for your OK on the Assistant page.`] : []),
    "",
    "Everything it did, one by one, is in AI settings:",
    adminUrl("/admin/ai"),
    "",
    "You can turn this monthly email off there too.",
  ].join("\n");
  return { subject: `${shop.name}: what the AI did in ${month.label}`, text };
}

/**
 * On the first days of a month, from the daily job: each store whose helpers did anything last
 * month gets its report, sent to the members who can see money. Claimed before sending, so two
 * runs can't send it twice.
 */
export async function sendAiImpactEmails(ctx: { db: Db; mailer: Mailer; adminUrl: (path: string) => string }, now = new Date()) {
  const { db } = ctx;
  const month = aiMonth(now, 1);
  const unsent = or(isNull(schema.shops.aiMonthlyReportFor), ne(schema.shops.aiMonthlyReportFor, month.key));
  const due = await db.query.shops.findMany({ where: and(eq(schema.shops.aiMonthlyEmail, true), unsent), limit: 200 });
  let sent = 0;
  for (const shop of due) {
    const [claimed] = await db.update(schema.shops).set({ aiMonthlyReportFor: month.key }).where(and(eq(schema.shops.id, shop.id), unsent)).returning({ id: schema.shops.id });
    if (!claimed || shop.createdAt >= month.to) continue;
    const impact = await aiImpact(db, shop.id, month);
    if (!impactLines(impact).length) continue;
    const people = await db
      .select({ email: schema.users.email, role: schema.shopMembers.role })
      .from(schema.shopMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
      .where(eq(schema.shopMembers.shopId, shop.id));
    const email = aiImpactEmail(impact, shop, month, ctx.adminUrl);
    for (const p of people.filter((x) => can(x.role, "money"))) {
      await ctx.mailer.send({ to: p.email, ...email });
      sent++;
    }
  }
  return { sent };
}
