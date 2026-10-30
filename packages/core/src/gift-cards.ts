// Gift cards and store credit. A merchant can sell gift cards as a product (each one bought
// issues a code worth what was paid) or give one to anyone, for example as store credit instead
// of a refund. Buyers enter the code in the cart's code box. Only a hash of each code is stored:
// the code is emailed once, and a lost code is replaced by sending a new one.
import { createHash, randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";
import { giftCardBonusFor } from "./gift-card-bonus";
import { formatMoney, parseMoney } from "./money";

type Shop = typeof schema.shops.$inferSelect;
type GiftCard = typeof schema.giftCards.$inferSelect;
export type GiftCardContext = { db: Db; mailer: Mailer; storeAddress: (shop: Shop) => string | Promise<string> };

// No 0/O or 1/I, so codes read back without mistakes. 16 characters is 80 bits.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 16;
export const MAX_GIFT_CARD_MINOR = 1_000_000;
/** How far ahead a gift card can be set to arrive. */
export const GIFT_CARD_SEND_DAYS = 90;

export function newGiftCardCode() {
  const raw = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return raw.match(/.{4}/g)!.join("-");
}

/** Upper case without spaces or dashes, or null if it can't be a gift card code. */
export function normalizeGiftCardCode(input: string) {
  const clean = input.toUpperCase().replace(/[\s-]/g, "");
  return clean.length === LENGTH && /^[A-Z0-9]+$/.test(clean) ? clean : null;
}

const hash = (normalized: string) => createHash("sha256").update(normalized).digest("hex");

const dayWords = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A usable card for this code, or a message for the buyer. */
export async function findGiftCard(db: Db, shop: Shop, code: string, now = new Date()) {
  const normalized = normalizeGiftCardCode(code);
  const card = normalized
    ? await db.query.giftCards.findFirst({ where: and(eq(schema.giftCards.shopId, shop.id), eq(schema.giftCards.codeHash, hash(normalized))) })
    : undefined;
  if (!card || card.currency !== shop.currency) throw new UserError("That gift card code isn't right. Check it against your email.", "gift_card_invalid");
  if (card.disabledAt) throw new UserError("That gift card has been turned off. Contact the store if you think that's a mistake.", "gift_card_invalid");
  if (card.balanceMinor <= 0) throw new UserError("That gift card has been used up.", "gift_card_invalid");
  if (card.usableFrom && card.usableFrom > now) throw new UserError(`That bonus card can be used from ${dayWords(card.usableFrom)}.`, "gift_card_invalid");
  if (card.expiresAt && card.expiresAt <= now) throw new UserError(`That bonus card expired on ${dayWords(new Date(card.expiresAt.getTime() - 1))}.`, "gift_card_invalid");
  return card;
}

const issueSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the email to send the gift card to."),
  amountMinor: z.number().int().min(100, "Gift cards start at 1.00.").max(MAX_GIFT_CARD_MINOR, "Gift cards go up to 10,000.00."),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
});

async function insertCard(db: Db, values: Omit<typeof schema.giftCards.$inferInsert, "codeHash" | "last4">) {
  const code = newGiftCardCode();
  const normalized = normalizeGiftCardCode(code)!;
  const [card] = await db
    .insert(schema.giftCards)
    .values({ ...values, codeHash: hash(normalized), last4: normalized.slice(-4) })
    .onConflictDoNothing()
    .returning();
  return card ? { card, code } : null;
}

/** When a card can be spent, for its email. */
function cardDates(card: Pick<GiftCard, "usableFrom" | "expiresAt">) {
  const until = card.expiresAt ? dayWords(new Date(card.expiresAt.getTime() - 1)) : null;
  if (card.usableFrom) return `You can use it from ${dayWords(card.usableFrom)}${until ? ` until ${until}` : ""}, and whatever you don't spend stays on the card.`;
  if (until) return `You can use it until ${until}, and whatever you don't spend stays on the card.`;
  return "It never expires, and whatever you don't spend stays on the card.";
}

async function sendCode(ctx: GiftCardContext, shop: Shop, card: GiftCard, code: string, intro: string, gift?: { name: string | null; from: string }) {
  const store = await ctx.storeAddress(shop);
  try {
    await ctx.mailer.send({
      to: card.email,
      subject: gift ? `${gift.from} sent you a ${formatMoney(card.balanceMinor, card.currency)} gift card for ${shop.name}` : `Your ${formatMoney(card.balanceMinor, card.currency)} ${card.bonus ? "bonus card" : "gift card"} for ${shop.name}`,
      text:
        `Hi${gift?.name ? ` ${gift.name}` : ""},\n\n${intro}\n\nGift card code: ${code}\nBalance: ${formatMoney(card.balanceMinor, card.currency)}\n` +
        (card.note ? (gift ? `\nMessage from ${gift.from}: ${card.note}\n` : `\nNote: ${card.note}\n`) : "") +
        `\nShop at ${store} and enter the code in your cart. ${cardDates(card)}\n` +
        `\nCheck what's left on it: ${store}/gift-cards\n`,
    });
    await ctx.db.update(schema.giftCards).set({ sentAt: new Date() }).where(eq(schema.giftCards.id, card.id));
    return true;
  } catch {
    return false;
  }
}

/** The merchant gives a gift card, for example as store credit. The code is emailed. */
export async function issueGiftCard(ctx: GiftCardContext, shop: Shop, input: { email: string; amountMinor: number; note?: string; userId?: string | null }) {
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { email, amountMinor, note } = parsed.data;
  const made = await insertCard(ctx.db, {
    shopId: shop.id,
    currency: shop.currency,
    initialMinor: amountMinor,
    balanceMinor: amountMinor,
    email,
    note: note || null,
    createdBy: input.userId ?? null,
  });
  if (!made) throw new Error("Couldn't make a unique gift card code.");
  const sent = await sendCode(ctx, shop, made.card, made.code, `${shop.name} sent you a gift card.`);
  return { card: made.card, sent, code: made.code };
}

/** The day a scheduled gift card goes out, in words: "December 24, 2026". */
const sendDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Issues one card per gift card bought on an order, worth what the buyer paid for it, and emails
 * the codes to the buyer, or to the person they bought them for (now, or on the day they picked,
 * when the daily job sends them). Safe to run again: cards already made for the order are skipped.
 */
export async function issueGiftCardsForOrder(ctx: GiftCardContext, orderId: string) {
  const order = await ctx.db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order || order.paymentStatus !== "paid") return { issued: 0, onlyGiftCards: false };
  const shop = await ctx.db.query.shops.findFirst({ where: eq(schema.shops.id, order.shopId) });
  if (!shop) return { issued: 0, onlyGiftCards: false };
  const lines = await ctx.db
    .select({ line: schema.orderLines, giftCard: schema.products.giftCard })
    .from(schema.orderLines)
    .leftJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .leftJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(eq(schema.orderLines.orderId, order.id))
    .orderBy(asc(schema.orderLines.id));
  const to = order.giftCardDelivery;
  const scheduledFor = to?.sendOn ? new Date(`${to.sendOn}T00:00:00Z`) : null;
  let index = 0;
  let issued = 0;
  for (const { line, giftCard } of lines) {
    if (!giftCard) continue;
    for (let n = 0; n < line.quantity; n++, index++) {
      const made = await insertCard(ctx.db, {
        shopId: shop.id,
        currency: order.currency,
        initialMinor: line.unitPriceMinor,
        balanceMinor: line.unitPriceMinor,
        email: to?.email ?? order.email,
        note: to?.message ?? null,
        sourceOrderId: order.id,
        sourceIndex: index,
        scheduledFor,
      });
      if (!made) continue; // already issued
      issued++;
      // A card for later keeps no code: a new one is made the day it goes out.
      if (scheduledFor) continue;
      if (to) await sendCode(ctx, shop, made.card, made.code, giftIntro(shop, to.from), to);
      else await sendCode(ctx, shop, made.card, made.code, `Thanks for your order #${order.number}. Here's the gift card you bought. Forward this email to give it to someone.`);
    }
  }
  const bonus = await issueBonusCard(ctx, shop, order, lines.filter((l) => l.giftCard).reduce((sum, { line }) => sum + line.unitPriceMinor * line.quantity, 0));
  // The buyer hears where their gift cards went, and when.
  if (to && issued) {
    const when = scheduledFor ? `will be emailed to ${to.email} on ${sendDay(to.sendOn!)}` : `went to ${to.email}`;
    await ctx.mailer
      .send({
        to: order.email,
        subject: `Your gift card for ${to.name ?? to.email} from ${shop.name}`,
        text:
          `Hi,\n\nThanks for your order #${order.number}. The ${issued === 1 ? "gift card" : `${issued} gift cards`} you bought ${when}` +
          `${to.message ? `, with your message` : ""}. Ask the store if anything needs changing.\n`,
      })
      .catch(() => undefined);
  }
  return { issued, bonusMinor: bonus?.initialMinor ?? 0, onlyGiftCards: lines.length > 0 && lines.every((l) => l.giftCard) };
}

/** Where a bonus card sits among an order's cards, so it's only ever made once. */
const BONUS_INDEX = -1;

/** The store's bonus card for the gift cards on a paid order, emailed to the buyer. Null when the offer doesn't apply or it was already made. */
async function issueBonusCard(ctx: GiftCardContext, shop: Shop, order: typeof schema.orders.$inferSelect, giftCardsMinor: number) {
  const bonus = giftCardBonusFor(shop, giftCardsMinor, order.paidAt ?? order.createdAt);
  if (!bonus) return null;
  const made = await insertCard(ctx.db, {
    shopId: shop.id,
    currency: order.currency,
    initialMinor: bonus.amountMinor,
    balanceMinor: bonus.amountMinor,
    email: order.email,
    sourceOrderId: order.id,
    sourceIndex: BONUS_INDEX,
    bonus: true,
    usableFrom: bonus.usableFrom,
    expiresAt: bonus.expiresAt,
  });
  if (!made) return null;
  await sendCode(ctx, shop, made.card, made.code, `Thanks for buying gift cards on order #${order.number}. Here's a bonus card for you to keep.`);
  return made.card;
}

const giftIntro = (shop: Shop, from: string) => `${from} sent you a gift card for ${shop.name}.`;

/**
 * Gift cards bought for someone else whose day has come: each gets a fresh code, emailed to them.
 * A card is claimed before its email, so two runs never send one twice; a failed email is tried
 * again on the next run.
 */
export async function sendScheduledGiftCards(ctx: GiftCardContext, opts: { now?: Date; limit?: number } = {}) {
  const g = schema.giftCards;
  const t = opts.now ?? new Date();
  const due = await ctx.db
    .select({ card: g, delivery: schema.orders.giftCardDelivery })
    .from(g)
    .leftJoin(schema.orders, eq(schema.orders.id, g.sourceOrderId))
    .where(and(isNull(g.sentAt), isNotNull(g.scheduledFor), lte(g.scheduledFor, t), isNull(g.disabledAt)))
    .orderBy(asc(g.scheduledFor))
    .limit(opts.limit ?? 200);
  const shops = new Map<string, Shop | undefined>();
  let sent = 0;
  for (const { card, delivery } of due) {
    if (!shops.has(card.shopId)) shops.set(card.shopId, await ctx.db.query.shops.findFirst({ where: eq(schema.shops.id, card.shopId) }));
    const shop = shops.get(card.shopId);
    if (!shop) continue;
    const code = newGiftCardCode();
    const normalized = normalizeGiftCardCode(code)!;
    const [claimed] = await ctx.db
      .update(g)
      .set({ codeHash: hash(normalized), last4: normalized.slice(-4), sentAt: t })
      .where(and(eq(g.id, card.id), isNull(g.sentAt)))
      .returning();
    if (!claimed) continue;
    const from = claimed.fromName ?? delivery?.from ?? null;
    const gift = from ? { name: claimed.recipientName ?? delivery?.name ?? null, from } : undefined;
    const ok = await sendCode(ctx, shop, claimed, code, giftIntro(shop, from ?? shop.name), gift);
    if (ok) sent++;
    else await ctx.db.update(g).set({ sentAt: null }).where(eq(g.id, card.id));
  }
  return { sent };
}

/** At most this many gift cards in one bulk send. */
export const BULK_GIFT_CARD_MAX = 500;

export type BulkGiftCardRow = { email: string; amountMinor: number; name: string | null };

/** One pasted row's cells: split by tabs (copied from a spreadsheet), else semicolons, else commas outside quotes. */
function cellsOf(line: string) {
  const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Reads pasted spreadsheet rows, one gift card each: email, amount, and an optional name. A first
 * row that doesn't start with an email is taken as headings.
 */
export function parseBulkGiftCards(text: string): BulkGiftCardRow[] {
  const lines = text.split(/\r?\n/).map((l, i) => ({ n: i + 1, cells: cellsOf(l) })).filter((l) => l.cells.some(Boolean));
  if (lines.length && !lines[0]!.cells[0]!.includes("@")) lines.shift();
  if (!lines.length) throw new UserError("Paste at least one row: an email and an amount.");
  if (lines.length > BULK_GIFT_CARD_MAX) throw new UserError(`Send up to ${BULK_GIFT_CARD_MAX} gift cards at a time.`);
  return lines.map(({ n, cells: [email = "", amount = "", name = ""] }) => {
    const address = email.toLowerCase();
    if (!z.string().email().safeParse(address).success) throw new UserError(`Row ${n}: "${email || "(empty)"}" isn't an email.`);
    let amountMinor: number;
    try {
      const bare = amount.replace(/^[^\d]+/, "").replace(/[^\d.,]+$/, "");
      // "25,50" is 25.50 where commas mark decimals.
      amountMinor = parseMoney(/^\d+,\d{1,2}$/.test(bare) ? bare.replace(",", ".") : bare);
    } catch {
      throw new UserError(`Row ${n}: enter the amount like 50 or 25.00.`);
    }
    if (amountMinor < 100 || amountMinor > MAX_GIFT_CARD_MINOR) throw new UserError(`Row ${n}: gift cards go from 1.00 to 10,000.00.`);
    if (name.length > 60) throw new UserError(`Row ${n}: keep the name under 60 characters.`);
    return { email: address, amountMinor, name: name || null };
  });
}

const bulkSchema = z.object({
  from: z.string().trim().max(60, "Keep who it's from under 60 characters.").optional().transform((f) => f || null),
  message: z.string().trim().max(300, "Keep the message under 300 characters.").optional().transform((m) => m || null),
  sendOn: z
    .string()
    .trim()
    .optional()
    .transform((d) => d || null)
    .refine((d) => d === null || (/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d)), "Pick the day to send them.")
    .refine((d) => d === null || Date.parse(`${d}T00:00:00Z`) <= Date.now() + GIFT_CARD_SEND_DAYS * 86_400_000, `Gift cards can be sent up to ${GIFT_CARD_SEND_DAYS} days ahead.`),
});

export type BulkGiftCardInput = { rows: string; from?: string; message?: string; sendOn?: string };

/** Checks a bulk send before it goes: the rows, who it's from, the message and the day. */
export function checkBulkGiftCards(input: BulkGiftCardInput, now = new Date()) {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const rows = parseBulkGiftCards(input.rows);
  const { from, message, sendOn } = parsed.data;
  // A day that has already come sends now.
  const scheduledFor = sendOn && Date.parse(`${sendOn}T00:00:00Z`) > now.getTime() ? new Date(`${sendOn}T00:00:00Z`) : null;
  return { rows, from, message, scheduledFor, totalMinor: rows.reduce((s, r) => s + r.amountMinor, 0) };
}

/**
 * Gives a gift card to each pasted row, for a company's team or a list of winners: the codes are
 * emailed now, or on the day picked (each gets a fresh code that morning). With a "from", each
 * email reads as a gift from them, with the person's name and the message.
 */
export async function issueBulkGiftCards(ctx: GiftCardContext, shop: Shop, input: BulkGiftCardInput & { userId?: string | null }, now = new Date()) {
  const { rows, from, message, scheduledFor, totalMinor } = checkBulkGiftCards(input, now);
  let issued = 0;
  let sent = 0;
  for (const row of rows) {
    const made = await insertCard(ctx.db, {
      shopId: shop.id,
      currency: shop.currency,
      initialMinor: row.amountMinor,
      balanceMinor: row.amountMinor,
      email: row.email,
      note: message,
      recipientName: row.name,
      fromName: from,
      createdBy: input.userId ?? null,
      scheduledFor,
    });
    if (!made) continue;
    issued++;
    if (scheduledFor) continue;
    const ok = from
      ? await sendCode(ctx, shop, made.card, made.code, giftIntro(shop, from), { name: row.name, from })
      : await sendCode(ctx, shop, made.card, made.code, `${shop.name} sent you a gift card.`);
    if (ok) sent++;
  }
  return { issued, sent, scheduledFor, totalMinor };
}

/** Replaces a card's code (lost email, or a code someone shouldn't have). The old code stops working. */
export async function resendGiftCard(ctx: GiftCardContext, shop: Shop, cardId: string) {
  const card = await ctx.db.query.giftCards.findFirst({ where: and(eq(schema.giftCards.id, cardId), eq(schema.giftCards.shopId, shop.id)) });
  if (!card) throw new NotFoundError("Gift card");
  if (card.disabledAt) throw new UserError("Turn the gift card back on before sending a new code.");
  const code = newGiftCardCode();
  const normalized = normalizeGiftCardCode(code)!;
  const [updated] = await ctx.db
    .update(schema.giftCards)
    .set({ codeHash: hash(normalized), last4: normalized.slice(-4), sentAt: null, scheduledFor: null })
    .where(eq(schema.giftCards.id, card.id))
    .returning();
  const sent = await sendCode(ctx, shop, updated!, code, `${shop.name} sent you a new code for your gift card. The old code no longer works.`);
  if (!sent) throw new UserError("The new code couldn't be emailed. Try again in a minute.");
  return updated!;
}

export async function setGiftCardDisabled(db: Db, shopId: string, cardId: string, disabled: boolean) {
  const [row] = await db
    .update(schema.giftCards)
    .set({ disabledAt: disabled ? new Date() : null })
    .where(and(eq(schema.giftCards.id, cardId), eq(schema.giftCards.shopId, shopId)))
    .returning({ id: schema.giftCards.id });
  if (!row) throw new NotFoundError("Gift card");
}

export const GIFT_CARD_PAGE_SIZE = 50;
export type GiftCardStatus = "active" | "used" | "off";

/**
 * The admin list of gift cards, newest first, 50 a page. The search finds a card by its full code
 * (when a buyer reads it out), its last 4 characters, the email it went to, or the order it was
 * bought on. Also returns what's still unspent on every active card.
 */
export async function listGiftCards(db: Db, shopId: string, opts: { query?: string; status?: GiftCardStatus; page?: number; size?: number } = {}) {
  const g = schema.giftCards;
  const size = opts.size ?? GIFT_CARD_PAGE_SIZE;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const q = opts.query?.trim().slice(0, 100) ?? "";
  const code = normalizeGiftCardCode(q);
  const last4 = q.toUpperCase().replace(/[\s-]/g, "");
  const orderNumber = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
  const where = and(
    eq(g.shopId, shopId),
    opts.status === "active" ? and(isNull(g.disabledAt), gt(g.balanceMinor, 0)) : undefined,
    opts.status === "used" ? and(isNull(g.disabledAt), eq(g.balanceMinor, 0)) : undefined,
    opts.status === "off" ? isNotNull(g.disabledAt) : undefined,
    q
      ? or(
          code ? eq(g.codeHash, hash(code)) : undefined,
          last4.length === 4 ? eq(g.last4, last4) : undefined,
          sql`lower(${g.email}) like ${`%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`}`,
          orderNumber !== null ? sql`${g.sourceOrderId} in (select id from orders where shop_id = ${shopId} and number = ${orderNumber})` : undefined,
        )
      : undefined,
  );
  const [cards, [total], [unspent]] = await Promise.all([
    db
      .select({ card: g, orderNumber: schema.orders.number })
      .from(g)
      .leftJoin(schema.orders, eq(schema.orders.id, g.sourceOrderId))
      .where(where)
      // Cards from one order share a time; the later line comes first, as it would by time.
      .orderBy(desc(g.createdAt), sql`${g.sourceIndex} desc nulls last`, desc(g.id))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: sql<number>`count(*)::int` }).from(g).where(where),
    db
      .select({ outstanding: sql<number>`coalesce(sum(${g.balanceMinor}), 0)::bigint` })
      .from(g)
      .where(and(eq(g.shopId, shopId), isNull(g.disabledAt))),
  ]);
  return { cards: cards.map((c) => ({ ...c.card, orderNumber: c.orderNumber })), total: total!.n, outstandingMinor: Number(unspent?.outstanding ?? 0) };
}

/** The store's gift card product, if it sells them. */
export async function giftCardProduct(db: Db, shopId: string) {
  return db.query.products.findFirst({
    where: and(eq(schema.products.shopId, shopId), eq(schema.products.giftCard, true), sql`${schema.products.status} <> 'archived'`),
  });
}

/** Adds a "Gift card" product with one option per amount, live on the store. */
export async function createGiftCardProduct(db: Db, shop: Shop, amountsMinor: number[]) {
  const amounts = [...new Set(amountsMinor)].sort((a, b) => a - b);
  if (!amounts.length) throw new UserError("Enter at least one amount, like 25, 50, 100.");
  if (amounts.length > 8) throw new UserError("Up to 8 amounts.");
  if (amounts.some((a) => !Number.isInteger(a) || a < 100 || a > MAX_GIFT_CARD_MINOR)) throw new UserError("Amounts go from 1.00 to 10,000.00.");
  if (await giftCardProduct(db, shop.id)) throw new UserError("You already sell gift cards. Edit the amounts on the Gift card product.");
  return db.transaction(async (tx) => {
    const taken = await tx.query.products.findFirst({ where: and(eq(schema.products.shopId, shop.id), eq(schema.products.handle, "gift-card")) });
    const [product] = await tx
      .insert(schema.products)
      .values({
        shopId: shop.id,
        title: "Gift card",
        handle: taken ? `gift-card-${Date.now().toString(36)}` : "gift-card",
        descriptionHtml: `Sent by email right after you pay. Use it on anything at ${shop.name}. It never expires, and whatever isn't spent stays on the card.`,
        status: "active",
        giftCard: true,
      })
      .returning();
    await tx.insert(schema.variants).values(
      amounts.map((a, i) => ({ productId: product!.id, title: formatMoney(a, shop.currency), priceMinor: a, position: i, options: { Amount: formatMoney(a, shop.currency) } })),
    );
    return product!;
  });
}
