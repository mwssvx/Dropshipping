// Email campaigns: the merchant writes one email (a subject, a few paragraphs and a button) and
// sends it to buyers who said yes to marketing. Every email has a one-click unsubscribe and the
// store's mailing address. Clicks are counted and orders placed within a week are credited to it.
import { and, count, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { CAMPAIGN_AUDIENCES, schema, type CampaignAudience, type Db } from "@sf/db";
import { z } from "zod";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;
type Campaign = typeof schema.campaigns.$inferSelect;

export type CampaignContext = {
  db: Db;
  mailer: Mailer;
  /** The store's public address, like https://lumen.example.com, with no trailing slash. */
  storeAddress: (shop: Shop) => string | Promise<string>;
  now?: () => Date;
};

/** Marketing emails each store can send a month, on every plan. */
export const CAMPAIGN_EMAILS_PER_MONTH = 10_000;
/** How many emails one scheduled run sends, across all stores. */
export const CAMPAIGN_BATCH = 200;
/** An order counts toward a campaign when the buyer clicked it within this long. */
export const CAMPAIGN_CREDIT_DAYS = 7;

const DAY = 86_400_000;
const PLACED = ["paid", "partially_refunded", "refunded"] as const;

export const AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  subscribers: "Everyone who said yes to emails",
  customers: "Subscribers who have bought",
  not_bought: "Subscribers who haven't bought yet",
  lapsed: "Subscribers who haven't bought in 90 days",
};

const campaignInput = z.object({
  subject: z.string().trim().min(1, "Write a subject line.").max(150, "Keep the subject under 150 characters."),
  body: z.string().trim().min(1, "Write the email.").max(10_000, "Keep the email under 10,000 characters."),
  buttonLabel: z.string().trim().max(40, "Keep the button under 40 characters.").optional().transform((v) => v || null),
  buttonPath: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? (v.startsWith("/") ? v : `/${v}`) : null))
    .refine((v) => v === null || (/^\/[\w\-./?=&%]*$/.test(v) && !v.startsWith("//")), "The button link should be a page on your store, like /products/lamp."),
  audience: z.enum(CAMPAIGN_AUDIENCES).default("subscribers"),
});
export type CampaignInput = z.input<typeof campaignInput>;

function parse(input: CampaignInput) {
  const r = campaignInput.safeParse(input);
  if (!r.success) throw new UserError(r.error.issues[0]!.message);
  return r.data;
}

// ---------------------------------------------------------------------------
// Consent

/** Records a buyer's yes to marketing email (at checkout or on their account page). */
export async function subscribeBuyer(db: Db, shopId: string, email: string, now = new Date()) {
  const address = email.trim().toLowerCase();
  await db
    .insert(schema.customers)
    .values({ shopId, email: address, acceptsMarketing: true, marketingConsentAt: now })
    .onConflictDoUpdate({
      target: [schema.customers.shopId, schema.customers.email],
      set: { acceptsMarketing: true, marketingConsentAt: now, unsubscribedAt: null },
    });
}

export async function unsubscribeBuyer(db: Db, shopId: string, email: string, now = new Date()) {
  await db
    .update(schema.customers)
    .set({ acceptsMarketing: false, unsubscribedAt: now })
    .where(and(eq(schema.customers.shopId, shopId), eq(schema.customers.email, email.trim().toLowerCase())));
}

/** The unsubscribe link in every campaign email. Works without signing in, for that store only. */
export async function unsubscribeByToken(db: Db, shopId: string, token: string, now = new Date()) {
  const [row] = await db
    .update(schema.customers)
    .set({ acceptsMarketing: false, unsubscribedAt: now })
    .where(and(eq(schema.customers.shopId, shopId), eq(schema.customers.emailToken, token)))
    .returning({ email: schema.customers.email });
  return row ?? null;
}

export async function customerByToken(db: Db, shopId: string, token: string) {
  return (
    (await db.query.customers.findFirst({
      where: and(eq(schema.customers.shopId, shopId), eq(schema.customers.emailToken, token)),
      columns: { email: true, acceptsMarketing: true },
    })) ?? null
  );
}

// ---------------------------------------------------------------------------
// Drafts

export async function createCampaign(db: Db, shopId: string, userId: string | null, input: CampaignInput) {
  const v = parse(input);
  const [row] = await db.insert(schema.campaigns).values({ shopId, createdBy: userId, ...v }).returning();
  return row!;
}

async function find(db: Db, shopId: string, id: string) {
  const c = await db.query.campaigns.findFirst({ where: and(eq(schema.campaigns.id, id), eq(schema.campaigns.shopId, shopId)) });
  if (!c) throw new NotFoundError("Campaign");
  return c;
}

export async function updateCampaign(db: Db, shopId: string, id: string, input: CampaignInput) {
  const c = await find(db, shopId, id);
  if (c.status !== "draft") throw new UserError("This campaign has already gone out. Duplicate it to send a new version.");
  const [row] = await db.update(schema.campaigns).set({ ...parse(input), updatedAt: new Date() }).where(eq(schema.campaigns.id, id)).returning();
  return row!;
}

export async function deleteCampaign(db: Db, shopId: string, id: string) {
  const c = await find(db, shopId, id);
  if (c.status === "sending" || c.status === "sent") throw new UserError("Sent campaigns stay, so their results do too.");
  await db.delete(schema.campaigns).where(eq(schema.campaigns.id, id));
}

export async function duplicateCampaign(db: Db, shopId: string, userId: string | null, id: string) {
  const c = await find(db, shopId, id);
  return createCampaign(db, shopId, userId, {
    subject: c.subject,
    body: c.body,
    buttonLabel: c.buttonLabel ?? undefined,
    buttonPath: c.buttonPath ?? undefined,
    audience: c.audience,
  });
}

export async function getCampaign(db: Db, shopId: string, id: string) {
  return find(db, shopId, id);
}

// ---------------------------------------------------------------------------
// Audiences

/** Subscribers in an audience, as of now. */
async function audience(db: Db, shopId: string, which: CampaignAudience, now = new Date()) {
  const bought = sql<number>`(select count(*) from ${schema.orders} o where o.shop_id = ${schema.customers.shopId} and o.email = ${schema.customers.email} and o.payment_status in ('paid', 'partially_refunded', 'refunded'))`;
  const lastPaid = sql`(select max(o.paid_at) from ${schema.orders} o where o.shop_id = ${schema.customers.shopId} and o.email = ${schema.customers.email} and o.payment_status in ('paid', 'partially_refunded', 'refunded'))`;
  const filter =
    which === "customers"
      ? sql`${bought} > 0`
      : which === "not_bought"
        ? sql`${bought} = 0`
        : which === "lapsed"
          ? sql`${lastPaid} < ${new Date(now.getTime() - 90 * DAY)}`
          : undefined;
  return db
    .select({ id: schema.customers.id, email: schema.customers.email, name: schema.customers.name, token: schema.customers.emailToken })
    .from(schema.customers)
    .where(and(eq(schema.customers.shopId, shopId), eq(schema.customers.acceptsMarketing, true), filter))
    .orderBy(schema.customers.createdAt);
}

export async function audienceSizes(db: Db, shopId: string, now = new Date()) {
  const sizes = {} as Record<CampaignAudience, number>;
  for (const a of CAMPAIGN_AUDIENCES) sizes[a] = (await audience(db, shopId, a, now)).length;
  return sizes;
}

/** Campaign emails this store sent (or queued) since the first of the month, out of its allowance. */
export async function campaignAllowance(db: Db, shopId: string, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({ n: count() })
    .from(schema.campaignSends)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignSends.campaignId))
    .where(and(eq(schema.campaigns.shopId, shopId), gte(schema.campaignSends.createdAt, monthStart), inArray(schema.campaignSends.status, ["queued", "sent"])));
  const used = Number(row?.n ?? 0);
  return { used, limit: CAMPAIGN_EMAILS_PER_MONTH, left: Math.max(0, CAMPAIGN_EMAILS_PER_MONTH - used) };
}

// ---------------------------------------------------------------------------
// The email itself

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "there";

export function renderCampaign(
  shop: Pick<Shop, "name" | "mailingAddress">,
  c: Pick<Campaign, "subject" | "body" | "buttonLabel">,
  to: { name: string | null; clickUrl: string; unsubscribeUrl: string },
) {
  const body = c.body.replaceAll("{first_name}", firstName(to.name));
  const lines = [body, ""];
  if (c.buttonLabel) lines.push(`${c.buttonLabel}: ${to.clickUrl}`, "");
  lines.push(
    "—",
    `${shop.name}${shop.mailingAddress ? ` · ${shop.mailingAddress.replace(/\s*\n\s*/g, ", ")}` : ""}`,
    `You're getting this because you said yes to emails from ${shop.name}.`,
    `Unsubscribe: ${to.unsubscribeUrl}`,
  );
  return { subject: c.subject.replaceAll("{first_name}", firstName(to.name)), text: lines.join("\n") };
}

const links = async (ctx: CampaignContext, shop: Shop, sendId: string, token: string) => {
  const base = await ctx.storeAddress(shop);
  return { clickUrl: `${base}/r/${sendId}`, unsubscribeUrl: `${base}/unsubscribe/${token}` };
};

/** A copy to the merchant (or a teammate) before sending. Links go to the store's front page. */
export async function sendTestCampaign(ctx: CampaignContext, shop: Shop, id: string, to: string) {
  const c = await find(ctx.db, shop.id, id);
  const address = z.string().trim().toLowerCase().email("Enter a valid email address.").safeParse(to);
  if (!address.success) throw new UserError(address.error.issues[0]!.message);
  const base = await ctx.storeAddress(shop);
  const mail = renderCampaign(shop, c, { name: null, clickUrl: `${base}${c.buttonPath ?? "/"}`, unsubscribeUrl: `${base}/unsubscribe/test` });
  await ctx.mailer.send({ to: address.data, subject: `[Test] ${mail.subject}`, text: mail.text });
}

// ---------------------------------------------------------------------------
// Sending

/**
 * Sends now (or at `scheduledFor`). The audience is fixed at this moment, so people who sign up
 * later aren't added; anyone who unsubscribes before their email goes out is skipped.
 */
export async function startCampaign(ctx: CampaignContext, shop: Shop, id: string, opts: { scheduledFor?: Date | null } = {}) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const c = await find(db, shop.id, id);
  if (c.status !== "draft") throw new UserError("This campaign has already gone out.");
  if (shop.status !== "active") throw new UserError("Your store is paused, so it can't send marketing emails right now.");
  if (!shop.mailingAddress?.trim()) {
    throw new UserError("Add your mailing address first. The law requires it at the foot of every marketing email; a PO box works.", "needs_address");
  }
  if (opts.scheduledFor && opts.scheduledFor.getTime() < now.getTime() - 60_000) throw new UserError("Pick a time in the future.");
  const people = await audience(db, shop.id, c.audience, now);
  if (!people.length) throw new UserError("Nobody in this audience has said yes to emails yet.", "empty");
  const { left } = await campaignAllowance(db, shop.id, now);
  if (people.length > left) {
    throw new UserError(`That's ${people.length} emails and you have ${left} left this month (${CAMPAIGN_EMAILS_PER_MONTH.toLocaleString("en-US")} a month). Pick a smaller audience or wait for the 1st.`, "over_limit");
  }
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(schema.campaigns)
      .set({ status: opts.scheduledFor ? "scheduled" : "sending", scheduledFor: opts.scheduledFor ?? now, recipients: people.length, updatedAt: now })
      .where(and(eq(schema.campaigns.id, c.id), eq(schema.campaigns.status, "draft")))
      .returning();
    if (!claimed) throw new UserError("This campaign has already gone out.");
    for (let i = 0; i < people.length; i += 500) {
      await tx
        .insert(schema.campaignSends)
        .values(people.slice(i, i + 500).map((p) => ({ campaignId: c.id, customerId: p.id, email: p.email, createdAt: now })))
        .onConflictDoNothing();
    }
    return claimed;
  });
}

/** A scheduled campaign goes back to being a draft. */
export async function cancelScheduledCampaign(db: Db, shopId: string, id: string) {
  const c = await find(db, shopId, id);
  if (c.status !== "scheduled") throw new UserError("Only a scheduled campaign can be cancelled.");
  await db.transaction(async (tx) => {
    await tx.delete(schema.campaignSends).where(eq(schema.campaignSends.campaignId, c.id));
    await tx.update(schema.campaigns).set({ status: "draft", scheduledFor: null, recipients: 0, updatedAt: new Date() }).where(eq(schema.campaigns.id, c.id));
  });
}

/** Scheduled job: sends queued campaign emails that are due, a batch at a time. */
export async function sendCampaignBatches(ctx: CampaignContext, opts: { limit?: number } = {}) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  await db
    .update(schema.campaigns)
    .set({ status: "sending", updatedAt: now })
    .where(and(eq(schema.campaigns.status, "scheduled"), lt(schema.campaigns.scheduledFor, new Date(now.getTime() + 1000))));
  const batch = await db
    .select({ send: schema.campaignSends, campaign: schema.campaigns, shop: schema.shops, customer: schema.customers })
    .from(schema.campaignSends)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignSends.campaignId))
    .innerJoin(schema.shops, eq(schema.shops.id, schema.campaigns.shopId))
    .leftJoin(schema.customers, eq(schema.customers.id, schema.campaignSends.customerId))
    .where(and(eq(schema.campaignSends.status, "queued"), eq(schema.campaigns.status, "sending")))
    .orderBy(schema.campaignSends.createdAt)
    .limit(opts.limit ?? CAMPAIGN_BATCH);
  let sent = 0;
  let skipped = 0;
  for (const { send, campaign, shop, customer } of batch) {
    // Unsubscribed (or the store was paused) after the campaign started: don't send.
    if (!customer?.acceptsMarketing || shop.status !== "active") {
      await db.update(schema.campaignSends).set({ status: "skipped" }).where(eq(schema.campaignSends.id, send.id));
      skipped++;
      continue;
    }
    const urls = await links(ctx, shop, send.id, customer.emailToken);
    const mail = renderCampaign(shop, campaign, { name: customer.name, ...urls });
    try {
      await ctx.mailer.send({
        to: send.email,
        subject: mail.subject,
        text: mail.text,
        headers: { "List-Unsubscribe": `<${urls.unsubscribeUrl}/one-click>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      await db.update(schema.campaignSends).set({ status: "sent", sentAt: now }).where(eq(schema.campaignSends.id, send.id));
      sent++;
    } catch (e) {
      await db
        .update(schema.campaignSends)
        .set({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
        .where(eq(schema.campaignSends.id, send.id));
    }
  }
  // Campaigns with nothing left in the queue are done.
  await db
    .update(schema.campaigns)
    .set({ status: "sent", sentAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.campaigns.status, "sending"),
        sql`not exists (select 1 from ${schema.campaignSends} s where s.campaign_id = ${schema.campaigns.id} and s.status = 'queued')`,
      ),
    );
  return { sent, skipped };
}

// ---------------------------------------------------------------------------
// Results

/** A click on the button: counted once, and remembered so a later order is credited. */
export async function recordCampaignClick(db: Db, shopId: string, sendId: string, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(sendId)) return null;
  const [row] = await db
    .select({ send: schema.campaignSends, campaign: schema.campaigns })
    .from(schema.campaignSends)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignSends.campaignId))
    .where(and(eq(schema.campaignSends.id, sendId), eq(schema.campaigns.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  if (!row.send.clickedAt) await db.update(schema.campaignSends).set({ clickedAt: now }).where(and(eq(schema.campaignSends.id, sendId), isNull(schema.campaignSends.clickedAt)));
  return { campaignId: row.campaign.id, path: row.campaign.buttonPath ?? "/" };
}

/** Whether an id (from the click cookie) names a campaign this store sent, so checkout can credit it. */
export async function creditableCampaign(db: Db, shopId: string, campaignId: string | null | undefined) {
  if (!campaignId || !/^[0-9a-f-]{36}$/i.test(campaignId)) return null;
  const c = await db.query.campaigns.findFirst({
    where: and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.shopId, shopId), inArray(schema.campaigns.status, ["sending", "sent"])),
    columns: { id: true },
  });
  return c?.id ?? null;
}

export async function listCampaigns(db: Db, shopId: string) {
  const rows = await db.query.campaigns.findMany({ where: eq(schema.campaigns.shopId, shopId), orderBy: desc(schema.campaigns.createdAt), limit: 100 });
  if (!rows.length) return [];
  const stats = await campaignStatsFor(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, stats: stats.get(r.id) ?? emptyStats }));
}

const emptyStats = { sent: 0, skipped: 0, failed: 0, queued: 0, clicks: 0, orders: 0, salesMinor: 0 };

async function campaignStatsFor(db: Db, ids: string[]) {
  const sends = await db
    .select({
      id: schema.campaignSends.campaignId,
      sent: sql<number>`count(*) filter (where ${schema.campaignSends.status} = 'sent')`.mapWith(Number),
      skipped: sql<number>`count(*) filter (where ${schema.campaignSends.status} = 'skipped')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${schema.campaignSends.status} = 'failed')`.mapWith(Number),
      queued: sql<number>`count(*) filter (where ${schema.campaignSends.status} = 'queued')`.mapWith(Number),
      clicks: sql<number>`count(${schema.campaignSends.clickedAt})`.mapWith(Number),
    })
    .from(schema.campaignSends)
    .where(inArray(schema.campaignSends.campaignId, ids))
    .groupBy(schema.campaignSends.campaignId);
  const orders = await db
    .select({
      id: schema.orders.campaignId,
      orders: count(),
      salesMinor: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}), 0)`.mapWith(Number),
    })
    .from(schema.orders)
    .where(and(inArray(schema.orders.campaignId, ids), inArray(schema.orders.paymentStatus, [...PLACED])))
    .groupBy(schema.orders.campaignId);
  const out = new Map<string, typeof emptyStats>();
  for (const id of ids) {
    const s = sends.find((x) => x.id === id);
    const o = orders.find((x) => x.id === id);
    out.set(id, { ...emptyStats, ...(s ?? {}), orders: Number(o?.orders ?? 0), salesMinor: Number(o?.salesMinor ?? 0) });
  }
  return out;
}

export async function campaignStats(db: Db, id: string) {
  return (await campaignStatsFor(db, [id])).get(id) ?? emptyStats;
}

export async function setMailingAddress(db: Db, shopId: string, address: string) {
  const v = address.trim().slice(0, 300);
  if (v && v.length < 8) throw new UserError("Enter a full mailing address.");
  await db.update(schema.shops).set({ mailingAddress: v || null, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}
