// Push notifications for the merchant app. Events are found by looking at what changed (new paid
// orders, problem orders, payout holds, agent proposals, staff replies) rather than hooked into each
// place that changes them, and each event notifies each person once (push_messages unique key), so
// running the sweep often, or from several places at once, is safe.
import { and, eq, gte, inArray, isNotNull, ne, or } from "drizzle-orm";
import { PUSH_KINDS, schema, type Db, type PushKind } from "@sf/db";
import { formatMoney } from "../money";
import { REQUIREMENT_KINDS } from "../payouts";
import { UserError } from "../errors";

export type PushMessage = { to: string; title: string; body: string; url: string; sound: boolean };
export type PushResult = { ok: true } | { ok: false; error: string; deviceGone?: boolean };

export interface PushSender {
  readonly name: string;
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Expo's push service, which delivers to both Apple and Google. */
export class ExpoPushSender implements PushSender {
  readonly name = "expo";
  constructor(
    private accessToken?: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const out: PushResult[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const res = await this.fetchImpl(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(chunk.map((m) => ({ to: m.to, title: m.title, body: m.body, data: { url: m.url }, sound: m.sound ? "default" : null }))),
        });
        if (!res.ok) throw new Error(`Expo push returned ${res.status}`);
        const json = (await res.json()) as { data?: { status: string; message?: string; details?: { error?: string } }[] };
        chunk.forEach((_, j) => {
          const t = json.data?.[j];
          out.push(
            t?.status === "ok"
              ? { ok: true }
              : { ok: false, error: t?.message ?? "No ticket returned", deviceGone: t?.details?.error === "DeviceNotRegistered" },
          );
        });
      } catch (e) {
        chunk.forEach(() => out.push({ ok: false, error: (e as Error).message }));
      }
    }
    return out;
  }
}

/** Keeps messages in memory instead of sending them. Used in tests and when PUSH_PROVIDER=log. */
export class LogPushSender implements PushSender {
  readonly name = "log";
  sent: PushMessage[] = [];
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    this.sent.push(...messages);
    if (messages.length) console.info(`[push] ${messages.map((m) => `${m.title}: ${m.body}`).join(" | ")}`);
    return messages.map(() => ({ ok: true }));
  }
}

export function pushSenderFromEnv(env: Record<string, string | undefined>): PushSender {
  return env.PUSH_PROVIDER === "log" ? new LogPushSender() : new ExpoPushSender(env.EXPO_ACCESS_TOKEN || undefined);
}

export const PUSH_LABELS: Record<PushKind, string> = {
  new_order: "New orders",
  problem_order: "Orders that need you",
  payout_hold: "Payout holds and document requests",
  margin_alert: "Margin alerts",
  agent_proposal: "Changes waiting for your OK",
  escalation_reply: "Replies from our support team",
};
/** Not a kind of its own: turning this off makes new-order notifications silent. */
export const NEW_ORDER_SOUND = "new_order_sound";

/* Devices and settings */

const EXPO_TOKEN = /^(Exponent|Expo)PushToken\[[\w-]+\]$/;

export async function registerDevice(db: Db, userId: string, input: { token: string; platform: string }, now = new Date()) {
  if (!EXPO_TOKEN.test(input.token)) throw new UserError("That isn't a push token from the app.");
  if (!["ios", "android", "web"].includes(input.platform)) throw new UserError("Unknown platform.");
  const platform = input.platform as "ios" | "android" | "web";
  // A phone that changes hands moves to the new account.
  await db
    .insert(schema.pushDevices)
    .values({ userId, token: input.token, platform, createdAt: now, lastSeenAt: now })
    .onConflictDoUpdate({ target: schema.pushDevices.token, set: { userId, platform, lastSeenAt: now } });
}

export async function unregisterDevice(db: Db, userId: string, token: string) {
  await db.delete(schema.pushDevices).where(and(eq(schema.pushDevices.userId, userId), eq(schema.pushDevices.token, token)));
}

export async function getPushSettings(db: Db, userId: string) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  const off = new Set(user?.pushOff ?? []);
  return {
    kinds: PUSH_KINDS.map((k) => ({ kind: k, label: PUSH_LABELS[k], on: !off.has(k) })),
    newOrderSound: !off.has(NEW_ORDER_SOUND),
  };
}

export async function setPushSettings(db: Db, userId: string, input: { off: string[] }) {
  const allowed = new Set<string>([...PUSH_KINDS, NEW_ORDER_SOUND]);
  const off = [...new Set(input.off)].filter((k) => allowed.has(k));
  await db.update(schema.users).set({ pushOff: off }).where(eq(schema.users.id, userId));
  return getPushSettings(db, userId);
}

/* Events */

export type PushEvent = { kind: PushKind; ref: string; title: string; body: string; url: string; at: Date };

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What happened in a store since `since`, as notifications. `url` is a path inside the app. */
export async function collectPushEvents(db: Db, shopId: string, since: Date): Promise<PushEvent[]> {
  const [shop, orders, failed, holds, actions, staff] = await Promise.all([
    db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) }),
    db.query.orders.findMany({
      where: and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"]), gte(schema.orders.paidAt, since)),
      limit: 200,
    }),
    db
      .select({ f: schema.fulfillments, number: schema.orders.number })
      .from(schema.fulfillments)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.fulfillments.orderId))
      .where(
        and(
          eq(schema.fulfillments.shopId, shopId),
          or(eq(schema.fulfillments.status, "failed"), isNotNull(schema.fulfillments.problemCode)),
          gte(schema.fulfillments.updatedAt, since),
        ),
      )
      .limit(100),
    db.query.accountRequirements.findMany({
      where: and(eq(schema.accountRequirements.shopId, shopId), eq(schema.accountRequirements.holdsPayouts, true), gte(schema.accountRequirements.createdAt, since)),
    }),
    db.query.agentActions.findMany({
      where: and(eq(schema.agentActions.shopId, shopId), eq(schema.agentActions.status, "pending"), gte(schema.agentActions.createdAt, since)),
      limit: 100,
    }),
    db
      .select({ m: schema.messages })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(
        and(
          eq(schema.conversations.shopId, shopId),
          eq(schema.conversations.kind, "assistant"),
          eq(schema.messages.author, "staff"),
          ne(schema.messages.status, "discarded"),
          gte(schema.messages.createdAt, since),
        ),
      )
      .limit(50),
  ]);
  if (!shop) return [];
  const events: PushEvent[] = [];
  for (const o of orders) {
    events.push({ kind: "new_order", ref: o.id, title: `New order #${o.number}`, body: `${formatMoney(o.totalMinor, o.currency)} from ${o.email}`, url: `/orders/${o.id}`, at: o.paidAt! });
  }
  for (const { f, number } of failed) {
    // One per order and problem, so a retry that fails the same way doesn't notify again.
    const body = f.problemMessage ?? (f.problemCode === "late_shipment" ? "No tracking yet, later than usual." : "The supplier couldn't take it.");
    events.push({ kind: "problem_order", ref: `${f.orderId}:${f.problemCode ?? "problem"}`, title: `Order #${number} needs you`, body: clip(body), url: `/orders/${f.orderId}`, at: f.updatedAt });
  }
  for (const r of holds) {
    events.push({ kind: "payout_hold", ref: r.id, title: "Payouts are paused", body: `To restart them, send: ${REQUIREMENT_KINDS[r.kind].title}.`, url: "/money", at: r.createdAt });
  }
  for (const a of actions) {
    const margin = a.agent === "margin";
    events.push({ kind: margin ? "margin_alert" : "agent_proposal", ref: a.id, title: margin ? "Margin alert" : "Waiting for your OK", body: clip(a.summary), url: "/", at: a.createdAt });
  }
  for (const { m } of staff) {
    events.push({ kind: "escalation_reply", ref: m.id, title: "Our support team replied", body: clip(m.body), url: "/assistant", at: m.createdAt });
  }
  return events;
}

export type PushContext = { db: Db; push: PushSender };

/**
 * Sends each new event to every phone of every member of the store, once. Only events after a
 * phone was registered go to it, so signing in on a new phone doesn't replay old ones.
 */
export async function sendShopNotifications(ctx: PushContext, shopId: string, opts: { now?: Date; windowMs?: number } = {}) {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.windowMs ?? 48 * 3_600_000));
  const people = await ctx.db
    .select({ user: schema.users, device: schema.pushDevices })
    .from(schema.shopMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
    .innerJoin(schema.pushDevices, eq(schema.pushDevices.userId, schema.shopMembers.userId))
    .where(eq(schema.shopMembers.shopId, shopId));
  if (!people.length) return { sent: 0 };
  const events = await collectPushEvents(ctx.db, shopId, since);
  if (!events.length) return { sent: 0 };

  const byUser = new Map<string, { user: (typeof people)[number]["user"]; devices: (typeof people)[number]["device"][] }>();
  for (const p of people) {
    const entry = byUser.get(p.user.id) ?? { user: p.user, devices: [] };
    entry.devices.push(p.device);
    byUser.set(p.user.id, entry);
  }

  const outgoing: { rowId: string; message: PushMessage; deviceId: string }[] = [];
  for (const { user, devices } of byUser.values()) {
    const off = new Set(user.pushOff);
    for (const e of events) {
      const targets = devices.filter((d) => d.createdAt <= e.at);
      if (!targets.length) continue;
      const status = off.has(e.kind) ? "off" : "pending";
      const [row] = await ctx.db
        .insert(schema.pushMessages)
        .values({ shopId, userId: user.id, kind: e.kind, ref: e.ref, title: e.title, body: e.body, url: e.url, status })
        .onConflictDoNothing()
        .returning();
      if (!row || status === "off") continue;
      const sound = e.kind !== "new_order" || !off.has(NEW_ORDER_SOUND);
      for (const d of targets) outgoing.push({ rowId: row.id, deviceId: d.id, message: { to: d.token, title: e.title, body: e.body, url: e.url, sound } });
    }
  }
  if (!outgoing.length) return { sent: 0 };

  const results = await ctx.push.send(outgoing.map((o) => o.message));
  const outcome = new Map<string, string | null>();
  for (const [i, o] of outgoing.entries()) {
    const r = results[i] ?? { ok: false as const, error: "No result" };
    if (r.ok) outcome.set(o.rowId, null);
    else {
      if (!outcome.has(o.rowId)) outcome.set(o.rowId, r.error);
      if (r.deviceGone) await ctx.db.delete(schema.pushDevices).where(eq(schema.pushDevices.id, o.deviceId));
    }
  }
  for (const [rowId, error] of outcome) {
    await ctx.db.update(schema.pushMessages).set({ status: error ? "failed" : "sent", error }).where(eq(schema.pushMessages.id, rowId));
  }
  return { sent: [...outcome.values()].filter((e) => !e).length };
}

/** The scheduled job: every store with at least one phone signed in. */
export async function sendAllNotifications(ctx: PushContext, now = new Date()) {
  const shops = await ctx.db
    .selectDistinct({ shopId: schema.shopMembers.shopId })
    .from(schema.shopMembers)
    .innerJoin(schema.pushDevices, eq(schema.pushDevices.userId, schema.shopMembers.userId));
  let sent = 0;
  for (const { shopId } of shops) sent += (await sendShopNotifications(ctx, shopId, { now })).sent;
  return { sent };
}
