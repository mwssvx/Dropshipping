// Gift cards and store credit. A merchant can sell gift cards as a product (each one bought
// issues a code worth what was paid) or give one to anyone, for example as store credit instead
// of a refund. Buyers enter the code in the cart's code box. Only a hash of each code is stored:
// the code is emailed once, and a lost code is replaced by sending a new one.
import { createHash, randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";

type Shop = typeof schema.shops.$inferSelect;
type GiftCard = typeof schema.giftCards.$inferSelect;
export type GiftCardContext = { db: Db; mailer: Mailer; storeAddress: (shop: Shop) => string | Promise<string> };

// No 0/O or 1/I, so codes read back without mistakes. 16 characters is 80 bits.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 16;
export const MAX_GIFT_CARD_MINOR = 1_000_000;

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

/** A usable card for this code, or a message for the buyer. */
export async function findGiftCard(db: Db, shop: Shop, code: string) {
  const normalized = normalizeGiftCardCode(code);
  const card = normalized
    ? await db.query.giftCards.findFirst({ where: and(eq(schema.giftCards.shopId, shop.id), eq(schema.giftCards.codeHash, hash(normalized))) })
    : undefined;
  if (!card || card.currency !== shop.currency) throw new UserError("That gift card code isn't right. Check it against your email.", "gift_card_invalid");
  if (card.disabledAt) throw new UserError("That gift card has been turned off. Contact the store if you think that's a mistake.", "gift_card_invalid");
  if (card.balanceMinor <= 0) throw new UserError("That gift card has been used up.", "gift_card_invalid");
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

async function sendCode(ctx: GiftCardContext, shop: Shop, card: GiftCard, code: string, intro: string) {
  const store = await ctx.storeAddress(shop);
  try {
    await ctx.mailer.send({
      to: card.email,
      subject: `Your ${formatMoney(card.balanceMinor, card.currency)} gift card for ${shop.name}`,
      text:
        `Hi,\n\n${intro}\n\nGift card code: ${code}\nBalance: ${formatMoney(card.balanceMinor, card.currency)}\n` +
        (card.note ? `\nNote: ${card.note}\n` : "") +
        `\nShop at ${store} and enter the code in your cart. It never expires, and whatever you don't spend stays on the card.\n` +
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

/**
 * Issues one card per gift card bought on an order, worth what the buyer paid for it, and emails
 * the codes to the buyer. Safe to run again: cards already made for the order are skipped.
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
        email: order.email,
        sourceOrderId: order.id,
        sourceIndex: index,
      });
      if (!made) continue; // already issued
      issued++;
      await sendCode(ctx, shop, made.card, made.code, `Thanks for your order #${order.number}. Here's the gift card you bought. Forward this email to give it to someone.`);
    }
  }
  return { issued, onlyGiftCards: lines.length > 0 && lines.every((l) => l.giftCard) };
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
    .set({ codeHash: hash(normalized), last4: normalized.slice(-4), sentAt: null })
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
