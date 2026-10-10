import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import type { PaymentEvent, PaymentProvider } from "./payments";
import { applyDiscount, automaticOffers, bxgyMissing, describeDiscount, findUsableDiscount, spreadDiscount, type Discount, type OfferUnit } from "./discounts";
import { applyMoneyEvent } from "./payouts";
import { estimateProcessingFee, platformFeeFor } from "./plans";
import { BuiltInTaxCalculator, listTaxRegistrations, type TaxCalculator } from "./tax";
import { presentQuote } from "./currency";
import { creditableCampaign } from "./campaigns";
import { convertAmount, formatMoney, type DisplayFx } from "./money";
import { breakFor, describeBreak, percentOff, wholesaleTermsFor } from "./wholesale";
import { findGiftCard } from "./gift-cards";
import { bundleSavings, bundlesInCart } from "./bundles";
import { salePrice, salesFor } from "./sales";
import { addonsByProduct, type CheckoutAddon } from "./addons";
import { countryName, listShippingZones, priceRate, zoneFor } from "./shipping";
import { normalizeTags } from "./customers";

type Shop = typeof schema.shops.$inferSelect;
type Order = typeof schema.orders.$inferSelect;
export type CartLine = { variantId: string; quantity: number };


/**
 * Price a cart from the database. Never trusts prices sent by the browser. A discount code that
 * can't be used throws a message for the buyer. `buyerEmail` is the signed-in buyer (from their
 * session, never the form): an approved wholesale buyer gets wholesale prices instead of
 * quantity discounts, and can't add a discount code. Gift cards for sale never get discounts or
 * shipping. A gift card code pays for as much of the total as its balance covers. Bundles take
 * their percentage off full sets; they don't combine with a code, so whichever saves more is used.
 */
export async function quoteCart(
  db: Db,
  shop: Shop,
  lines: CartLine[],
  opts: {
    discountCode?: string | null;
    email?: string;
    buyerEmail?: string | null;
    giftCardCode?: string | null;
    /** Where it ships. Without it (the cart), shipping is estimated for `countryHint`, else the store's own country. */
    country?: string | null;
    /** Where the buyer seems to be, from their connection. Used for the estimate only if the store ships there. */
    countryHint?: string | null;
    shippingRateId?: string | null;
  } = {},
) {
  const wanted = lines.filter((l) => l.quantity > 0);
  if (!wanted.length) throw new UserError("Your cart is empty.");
  const rows = await db
    .select({ variant: schema.variants, product: schema.products })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(
      and(
        inArray(schema.variants.id, wanted.map((l) => l.variantId)),
        eq(schema.products.shopId, shop.id),
        eq(schema.products.status, "active"),
      ),
    );
  const wholesale = await wholesaleTermsFor(db, shop, opts.buyerEmail);
  const sales = await salesFor(db, shop.id, rows.map((r) => r.product.id));
  // An add-on keeps its price when it's bought with something else (and not at wholesale).
  const addons = wholesale ? new Map<string, CheckoutAddon>() : await addonsByProduct(db, shop.id, rows.map((r) => r.product.id));
  const goodsProducts = new Set(rows.filter((r) => !r.product.giftCard && wanted.some((l) => l.variantId === r.variant.id)).map((r) => r.product.id));
  // Quantity discounts count every variant of a product together (2 small + 1 large = 3).
  const perProduct = new Map<string, number>();
  for (const l of wanted) {
    const productId = rows.find((r) => r.variant.id === l.variantId)?.product.id;
    if (productId) perProduct.set(productId, (perProduct.get(productId) ?? 0) + l.quantity);
  }
  const items = wanted.map((l) => {
    const row = rows.find((r) => r.variant.id === l.variantId);
    if (!row) throw new UserError("An item in your cart is no longer available.", "unavailable");
    if (!Number.isInteger(l.quantity) || l.quantity > 99) throw new UserError("Quantity must be between 1 and 99.");
    if (row.variant.stock !== null && row.variant.stock < l.quantity) {
      throw new UserError(row.variant.stock > 0 ? `Only ${row.variant.stock} of ${row.product.title} left.` : `${row.product.title} is sold out.`, "unavailable");
    }
    const title = row.variant.title === "Default" ? row.product.title : `${row.product.title} – ${row.variant.title}`;
    const giftCard = row.product.giftCard;
    const addon = giftCard ? undefined : addons.get(row.product.id);
    const withOthers = addon && [...goodsProducts].some((id) => id !== row.product.id) ? addon : undefined;
    const tier = wholesale || giftCard || withOthers?.percentOff ? null : breakFor(row.product.quantityBreaks, perProduct.get(row.product.id) ?? l.quantity);
    const pct = giftCard ? 0 : (wholesale?.percentOff ?? (withOthers?.percentOff || tier?.percentOff) ?? 0);
    // Other discounts come off the sale price.
    const sale = giftCard ? null : (sales.get(row.product.id) ?? null);
    const listed = salePrice(row.variant.priceMinor, null, sale).priceMinor;
    const unit = pct ? percentOff(listed, pct) : listed;
    const notes = [
      sale ? `${sale.title}: ${sale.percentOff}% off` : null,
      giftCard ? null : wholesale ? `Wholesale price, ${wholesale.percentOff}% off` : withOthers?.percentOff ? `Add-on price, ${withOthers.percentOff}% off` : tier ? describeBreak(tier) : null,
    ];
    return {
      variantId: row.variant.id,
      productId: row.product.id,
      productHandle: row.product.handle,
      title,
      // The picked colour's photo, when it has one.
      imageUrl: row.variant.imageUrl ?? row.product.imageUrl,
      quantity: l.quantity,
      /** The price before sales, quantity or wholesale discounts, shown struck through when it differs. */
      listUnitPriceMinor: row.variant.priceMinor,
      unitPriceMinor: unit,
      unitCostMinor: row.variant.costMinor,
      lineMinor: unit * l.quantity,
      priceNote: notes.filter(Boolean).join(" · ") || null,
      /** Set when the line is the checkout add-on at its price. */
      addonId: withOthers?.id ?? null,
      giftCard,
    };
  });
  const subtotalMinor = items.reduce((s, i) => s + i.lineMinor, 0);
  // Discounts and shipping only count goods: gift cards are sent by email at face value.
  const goodsMinor = items.filter((i) => !i.giftCard).reduce((s, i) => s + i.lineMinor, 0);
  const hasGoods = items.some((i) => !i.giftCard);
  let shippingMinor = 0;
  let shipping: { rateId: string; name: string; minDays: number | null; maxDays: number | null } | null = null;
  let freeShippingOverMinor: number | null = null;
  if (hasGoods) {
    const { zones } = await listShippingZones(db, shop.id);
    const hinted = opts.countryHint && zoneFor(zones, opts.countryHint)?.rates.length ? opts.countryHint : null;
    const rates = zoneFor(zones, opts.country ?? hinted ?? shop.country)?.rates ?? [];
    // The lowest amount that makes a paid rate free, unless a rate is free anyway.
    if (!rates.some((r) => r.priceMinor === 0)) {
      const over = rates.map((r) => r.freeOverMinor).filter((m): m is number => m !== null);
      if (over.length) freeShippingOverMinor = Math.min(...over);
    }
    if (!rates.length && opts.country) throw new UserError(`${shop.name} doesn't ship to ${countryName(opts.country)} yet.`, "no_shipping");
    // The rate the buyer picked, or the cheapest for this cart.
    const rate = rates.find((r) => r.id === opts.shippingRateId) ?? [...rates].sort((a, b) => priceRate(a, goodsMinor) - priceRate(b, goodsMinor))[0];
    if (rate) {
      shippingMinor = priceRate(rate, goodsMinor);
      shipping = { rateId: rate.id, name: rate.name, minDays: rate.minDays, maxDays: rate.maxDays };
    }
  }
  // Wholesale buyers already have their own prices.
  const goods = items.filter((i) => !i.giftCard);
  const savings = wholesale ? [] : bundleSavings(await bundlesInCart(db, shop.id, [...new Set(goods.map((i) => i.productId))]), goods);
  let bundle = savings.length
    ? { title: savings.map((b) => b.title).join(" + "), savings, discountMinor: savings.reduce((s, b) => s + b.savingMinor, 0) }
    : null;
  type AppliedDiscount = { id: string; code: string; label: string; discountMinor: number; freeShipping: boolean; automatic: boolean };
  // Set inside use(), which TypeScript can't follow, hence the cast.
  let discount = null as AppliedDiscount | null;
  /** A valid code the cart didn't use because the bundle saves more. */
  let codeNotUsed: string | null = null;
  /** An automatic buy X get Y offer the cart is one step from: "add 1 more and it's free". */
  let offerNudge = null as { label: string; missing: number; free: boolean } | null;
  const units: OfferUnit[] = goods.map((i) => ({ productId: i.productId, unitMinor: i.unitPriceMinor, quantity: i.quantity }));
  const use = (d: Discount, applied: { discountMinor: number; shippingMinor: number }) => {
    bundle = null;
    shippingMinor = applied.shippingMinor;
    discount = { id: d.id, code: d.code, label: describeDiscount(d, shop.currency), discountMinor: applied.discountMinor, freeShipping: d.kind === "free_shipping", automatic: d.automatic };
  };
  if (opts.discountCode?.trim() && wholesale) throw new UserError("Discount codes don't apply to wholesale prices.", "discount_invalid");
  if (opts.discountCode?.trim()) {
    const d = await findUsableDiscount(db, shop, opts.discountCode, { subtotalMinor: goodsMinor, email: opts.email });
    const applied = applyDiscount(d, goodsMinor, shippingMinor, units);
    if (d.kind === "bxgy" && !applied.discountMinor) {
      throw new UserError(`${d.code} is for "${describeDiscount(d, shop.currency)}". Add more to your cart to use it.`, "discount_invalid");
    }
    if (bundle && bundle.discountMinor > applied.discountMinor + (shippingMinor - applied.shippingMinor)) {
      codeNotUsed = d.code;
    } else {
      use(d, applied);
    }
  } else if (!wholesale && hasGoods) {
    // Offers that need no code: the one saving the most, unless a bundle saves more.
    let best: { d: Discount; applied: { discountMinor: number; shippingMinor: number } } | null = null;
    for (const d of await automaticOffers(db, shop.id)) {
      try {
        await findUsableDiscount(db, shop, d.code, { subtotalMinor: goodsMinor, email: opts.email });
      } catch (e) {
        if (e instanceof UserError) continue;
        throw e;
      }
      const applied = applyDiscount(d, goodsMinor, shippingMinor, units);
      if (applied.discountMinor > (best?.applied.discountMinor ?? 0)) best = { d, applied };
      const missing = bxgyMissing(d, units);
      if (missing && !offerNudge) offerNudge = { label: describeDiscount(d, shop.currency), missing, free: d.value >= 100 };
    }
    if (best && !(bundle && bundle.discountMinor >= best.applied.discountMinor)) use(best.d, best.applied);
  }
  const discountMinor = discount?.discountMinor ?? bundle?.discountMinor ?? 0;
  const totalMinor = subtotalMinor - discountMinor + shippingMinor;
  let giftCard: { id: string; last4: string; balanceMinor: number; appliedMinor: number } | null = null;
  if (opts.giftCardCode?.trim()) {
    if (!hasGoods || items.some((i) => i.giftCard)) throw new UserError("Gift cards can't be bought with a gift card.", "gift_card_invalid");
    const card = await findGiftCard(db, shop, opts.giftCardCode);
    giftCard = { id: card.id, last4: card.last4, balanceMinor: card.balanceMinor, appliedMinor: Math.min(card.balanceMinor, totalMinor) };
  }
  // Tax depends on where it ships, so it's added at checkout once the address is known.
  return {
    items,
    currency: shop.currency,
    subtotalMinor,
    discount,
    /** Bundle savings, when they're used instead of a code. */
    bundle,
    codeNotUsed,
    offerNudge,
    discountMinor,
    shippingMinor,
    totalMinor,
    goodsMinor,
    /** The rate used. Null when nothing needs shipping, or the cart's estimate country has no zone. */
    shipping,
    giftCard,
    /** What's left to pay by card after the gift card. Before tax, until checkout. */
    dueMinor: totalMinor - (giftCard?.appliedMinor ?? 0),
    pricesIncludeTax: shop.pricesIncludeTax,
    /** How far the cart is from free shipping. Null when shipping is free anyway or never free. */
    freeShipping:
      freeShippingOverMinor !== null && !discount?.freeShipping
        ? { overMinor: freeShippingOverMinor, shortByMinor: Math.max(0, freeShippingOverMinor - goodsMinor) }
        : null,
    wholesale: wholesale ? { ...wholesale, shortByMinor: Math.max(0, wholesale.minOrderMinor - subtotalMinor) } : null,
  };
}

export const addressSchema = z.object({
  name: z.string().trim().min(1, "Enter the name for delivery."),
  line1: z.string().trim().min(1, "Enter the street address."),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1, "Enter the city."),
  region: z.string().trim().optional(),
  postalCode: z.string().trim().min(2, "Enter the postal code."),
  country: z.string().trim().length(2, "Choose a country."),
});

const giftSchema = z.object({
  from: z.string().trim().min(1, "Add who the gift is from.").max(60, "Keep the name under 60 characters."),
  message: z.string().trim().max(300, "Keep the gift message under 300 characters.").optional().transform((m) => m || null),
  recipientEmail: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((e) => e || null)
    .refine((e) => e === null || z.string().email().safeParse(e).success, "Enter the recipient's email, or leave it empty."),
});

const checkoutSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email so we can send your receipt."),
  address: addressSchema,
  gift: giftSchema.nullish(),
  note: z.string().trim().max(500, "Keep your note under 500 characters.").nullish().transform((n) => n || null),
});

export async function startCheckout(
  db: Db,
  payments: PaymentProvider,
  shop: Shop,
  input: {
    email: string;
    address: Address;
    lines: CartLine[];
    discountCode?: string | null;
    fx?: DisplayFx | null;
    /** The buyer ticked "Send me news and offers". Unticked never withdraws an earlier yes. */
    acceptsMarketing?: boolean;
    /** From the campaign click cookie; checked to belong to this store. */
    campaignId?: string | null;
    /** The signed-in buyer, from their session. Wholesale prices follow the account. */
    buyerEmail?: string | null;
    /** A gift card code the buyer entered in the cart. */
    giftCardCode?: string | null;
    /** The shipping rate picked at checkout; the cheapest for the address if missing. */
    shippingRateId?: string | null;
    /** The buyer ticked "This order is a gift". */
    gift?: z.input<typeof giftSchema> | null;
    /** "Note for the store", for the merchant. */
    note?: string | null;
    /**
     * An after-checkout offer on an order just paid: its own percent off, no codes and no shipping.
     * The order is created unpaid; the caller charges the saved card.
     */
    followUp?: { parentOrderId: string; percentOff: number };
  },
  taxCalculator: TaxCalculator = new BuiltInTaxCalculator(),
) {
  if (shop.status !== "active") throw new UserError("This store isn't taking orders right now.", "shop_inactive");
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { email, address } = parsed.data;
  const gift = parsed.data.gift ?? null;
  const followUp = input.followUp ?? null;
  const quoted = await quoteCart(db, shop, input.lines, {
    discountCode: followUp ? null : input.discountCode,
    email,
    buyerEmail: followUp ? null : input.buyerEmail,
    giftCardCode: followUp ? null : input.giftCardCode,
    country: address.country,
    shippingRateId: input.shippingRateId,
  });
  const cart = followUp ? asFollowUp(quoted, followUp.percentOff) : quoted;
  if (cart.wholesale && cart.wholesale.shortByMinor > 0) {
    throw new UserError(
      `Wholesale orders start at ${formatMoney(cart.wholesale.minOrderMinor, shop.currency)}. Add ${formatMoney(cart.wholesale.shortByMinor, shop.currency)} more to check out.`,
      "wholesale_minimum",
    );
  }
  // A buyer shopping in another currency is charged exactly what they saw, in that currency.
  const fx = input.fx && input.fx.currency !== shop.currency && input.fx.rate > 0 ? input.fx : null;
  if (fx && cart.giftCard) {
    throw new UserError(`Gift cards are in ${shop.currency}. Switch the store to ${shop.currency} prices to use yours.`, "gift_card_currency");
  }
  // Tax is on what the buyer actually pays for each line, after the discount. Gift cards bought
  // here aren't taxed: tax is paid when they're spent.
  const taxed = spreadDiscount(cart.items.map((i) => (i.giftCard ? 0 : i.lineMinor)), cart.discountMinor);
  const tax = await taxCalculator.calculate({
    currency: cart.currency,
    lines: cart.items.map((i, n) => ({ reference: i.variantId, amountMinor: taxed[n]! })),
    shippingMinor: cart.shippingMinor,
    address,
    pricesIncludeTax: shop.pricesIncludeTax,
    accountId: shop.paymentsAccountId,
    registrations: (await listTaxRegistrations(db, shop.id)).map((r) => r.jurisdiction),
  });
  const quote = {
    ...cart,
    taxMinor: tax.taxMinor,
    taxIncluded: tax.included,
    taxBreakdown: tax.breakdown,
    totalMinor: cart.subtotalMinor - cart.discountMinor + cart.shippingMinor + (tax.included ? 0 : tax.taxMinor),
  };
  const giftCardMinor = cart.giftCard ? Math.min(cart.giftCard.balanceMinor, quote.totalMinor) : 0;
  const dueMinor = quote.totalMinor - giftCardMinor;
  // Our fee is on the sale, not on tax the merchant passes on to the government, and not on the
  // part paid with a gift card: the fee was taken when the gift card was sold.
  const platformFeeMinor = platformFeeFor(shop.plan, Math.max(0, quote.totalMinor - quote.taxMinor - giftCardMinor));
  const presentment = fx ? presentQuote({ ...quote, pricesIncludeTax: tax.included }, fx) : null;

  // The card is kept for the after-checkout offer, in the store's currency only.
  const saveCard = !followUp && !fx && !!dueMinor && !!shop.postPurchaseOffer?.active;
  // Paid in full by gift card: there's nothing to charge, so the order is paid right away. An
  // after-checkout order is charged to the saved card by the caller once it exists.
  const intent = followUp
    ? { id: `followup_${randomUUID()}`, clientSecret: "" }
    : dueMinor
      ? await payments.createPaymentIntent({
          amountMinor: presentment?.totalMinor ?? dueMinor,
          currency: presentment?.currency ?? quote.currency,
          shopAccountId: shop.paymentsAccountId,
          applicationFeeMinor: fx ? convertAmount(platformFeeMinor, fx) : platformFeeMinor,
          metadata: { shopId: shop.id },
          ...(saveCard ? { saveCard: { email } } : {}),
        })
      : { id: `giftcard_${randomUUID()}`, clientSecret: "" };

  const consent = input.acceptsMarketing ? { acceptsMarketing: true, marketingConsentAt: new Date(), unsubscribedAt: null } : {};
  const campaignId = await creditableCampaign(db, shop.id, input.campaignId);

  const order = await db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(schema.customers)
      .values({ shopId: shop.id, email, name: address.name, ...consent })
      .onConflictDoUpdate({ target: [schema.customers.shopId, schema.customers.email], set: { name: address.name, ...consent } })
      .returning({ id: schema.customers.id });
    // Lock the shop row so two checkouts can't take the same order number.
    await tx.execute(sql`select 1 from ${schema.shops} where ${schema.shops.id} = ${shop.id} for update`);
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${schema.orders.number}), 1000) + 1` })
      .from(schema.orders)
      .where(eq(schema.orders.shopId, shop.id))) as [{ next: number }];
    const [order] = await tx
      .insert(schema.orders)
      .values({
        shopId: shop.id,
        number: Number(next),
        customerId: customer!.id,
        email,
        shippingAddress: address,
        currency: quote.currency,
        subtotalMinor: quote.subtotalMinor,
        discountMinor: quote.discountMinor,
        discountId: quote.discount?.id ?? null,
        discountCode: quote.discount?.code ?? null,
        bundleTitle: quote.bundle?.title ?? null,
        shippingMinor: quote.shippingMinor,
        taxMinor: quote.taxMinor,
        taxIncluded: quote.taxIncluded,
        taxBreakdown: quote.taxBreakdown,
        taxCalculationId: tax.calculationId,
        totalMinor: quote.totalMinor,
        platformFeeMinor,
        processingFeeMinor: dueMinor ? estimateProcessingFee(dueMinor) : 0,
        presentment,
        campaignId,
        wholesale: !!cart.wholesale,
        giftCardId: cart.giftCard?.id ?? null,
        giftCardMinor,
        shippingMethod: cart.shipping?.name ?? null,
        // Only something that ships can be a gift; gift cards are emailed to the buyer.
        gift: gift && cart.items.some((i) => !i.giftCard) ? gift : null,
        buyerNote: parsed.data.note,
        ...(followUp ? { source: "post_purchase" as const, parentOrderId: followUp.parentOrderId } : {}),
        cardSaved: saveCard,
        paymentIntentId: intent.id,
        ...(dueMinor ? {} : { paymentStatus: "paid" as const, paidAt: new Date() }),
      })
      .returning();
    if (!dueMinor) {
      const [taken] = await tx
        .update(schema.giftCards)
        .set({ balanceMinor: sql`${schema.giftCards.balanceMinor} - ${giftCardMinor}` })
        .where(and(eq(schema.giftCards.id, cart.giftCard!.id), sql`${schema.giftCards.balanceMinor} >= ${giftCardMinor}`))
        .returning({ id: schema.giftCards.id });
      if (!taken) throw new UserError("Your gift card balance just changed. Go back to your cart to see what's left.", "gift_card_invalid");
    }
    await tx.insert(schema.orderLines).values(
      quote.items.map((i) => ({
        orderId: order!.id,
        variantId: i.variantId,
        title: i.title,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        unitCostMinor: i.unitCostMinor,
        addonId: i.addonId,
      })),
    );
    return order!;
  });

  return { order, clientSecret: intent.clientSecret, quote, paidWithGiftCard: !dueMinor };
}

/** An after-checkout offer's prices: its percent off each item, no codes or offers, no shipping. */
function asFollowUp(cart: Awaited<ReturnType<typeof quoteCart>>, percent: number) {
  const items = cart.items.map((i) => {
    const unitPriceMinor = percentOff(i.unitPriceMinor, percent);
    return { ...i, unitPriceMinor, lineMinor: unitPriceMinor * i.quantity };
  });
  const subtotalMinor = items.reduce((s, i) => s + i.lineMinor, 0);
  return {
    ...cart,
    items,
    subtotalMinor,
    goodsMinor: subtotalMinor,
    discount: null,
    bundle: null,
    discountMinor: 0,
    shippingMinor: 0,
    shipping: null,
    giftCard: null,
    wholesale: null,
    offerNudge: null,
    freeShipping: null,
    totalMinor: subtotalMinor,
    dueMinor: subtotalMinor,
  };
}

/** What the card is charged for an order: the total less any gift card, in the buyer's currency. */
export function amountToCharge(order: Pick<Order, "totalMinor" | "giftCardMinor" | "presentment">) {
  return order.presentment?.totalMinor ?? order.totalMinor - order.giftCardMinor;
}

/**
 * Apply a payment webhook. Safe to call twice with the same event: the event id is recorded
 * first, and a repeat is ignored.
 */
export async function handlePaymentEvent(db: Db, provider: string, event: PaymentEvent) {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.webhookEvents)
      .values({ id: event.id, provider })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvents.id });
    if (!inserted.length) return { status: "duplicate" as const };

    if (event.type !== "payment.succeeded" && event.type !== "payment.failed") {
      const applied = await applyMoneyEvent(tx as unknown as Db, event);
      await tx.update(schema.webhookEvents).set({ processedAt: new Date() }).where(eq(schema.webhookEvents.id, event.id));
      return { status: applied ? ("processed" as const) : ("unknown_account" as const), becamePaid: false as const };
    }

    const order = await tx.query.orders.findFirst({ where: eq(schema.orders.paymentIntentId, event.paymentIntentId) });
    if (!order) return { status: "unknown_order" as const };

    let becamePaid = false;
    if (event.type === "payment.succeeded") {
      if (event.amountMinor !== amountToCharge(order)) throw new Error(`Amount mismatch on order ${order.id}`);
      if (order.paymentStatus === "pending" || order.paymentStatus === "failed") {
        becamePaid = true;
        // The gift card is spent once the rest is paid. Checkout checked the balance; if it was spent
        // elsewhere in between, what's left is taken.
        if (order.giftCardId && order.giftCardMinor) {
          await tx
            .update(schema.giftCards)
            .set({ balanceMinor: sql`greatest(${schema.giftCards.balanceMinor} - ${order.giftCardMinor}, 0)` })
            .where(eq(schema.giftCards.id, order.giftCardId));
        }
        await tx
          .update(schema.orders)
          .set({ paymentStatus: "paid", paidAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.orders.id, order.id));
      }
    } else if (order.paymentStatus === "pending") {
      await tx.update(schema.orders).set({ paymentStatus: "failed", updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
    }
    await tx.update(schema.webhookEvents).set({ processedAt: new Date() }).where(eq(schema.webhookEvents.id, event.id));
    return { status: "processed" as const, orderId: order.id, becamePaid };
  });
}

export async function listOrders(
  db: Db,
  shopId: string,
  filter: { fulfillmentStatus?: Order["fulfillmentStatus"]; held?: boolean; tag?: string; query?: string } = {},
) {
  const tag = filter.tag?.trim().toLowerCase();
  // "1042", "#1042", a name or an email.
  const q = filter.query?.trim().toLowerCase().replace(/^#(?=\d+$)/, "");
  return db.query.orders.findMany({
    where: and(
      eq(schema.orders.shopId, shopId),
      filter.fulfillmentStatus ? eq(schema.orders.fulfillmentStatus, filter.fulfillmentStatus) : undefined,
      // Held for the risk check and still worth sending (a refunded one is settled).
      filter.held ? and(isNotNull(schema.orders.heldAt), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"])) : undefined,
      tag ? sql`${schema.orders.tags} @> ${JSON.stringify([tag])}::jsonb` : undefined,
      q
        ? /^\d{1,9}$/.test(q)
          ? eq(schema.orders.number, Number(q))
          : sql`(lower(${schema.orders.email}) like ${`%${q}%`} or lower(${schema.orders.shippingAddress}->>'name') like ${`%${q}%`})`
        : undefined,
    ),
    orderBy: desc(schema.orders.number),
  });
}

const orderNotesInput = z.object({
  note: z.string().max(2000, "Keep the note under 2,000 characters.").optional(),
  tags: z.union([z.string().max(500), z.array(z.string())]).optional(),
});

/** The merchant's own note and tags on an order. The buyer never sees them. */
export async function updateOrderNotes(db: Db, shopId: string, orderId: string, input: z.input<typeof orderNotesInput>) {
  const parsed = orderNotesInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  if (!z.string().uuid().safeParse(orderId).success) throw new NotFoundError("Order");
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Order");
  const staffNote = parsed.data.note === undefined ? order.staffNote : parsed.data.note.trim() || null;
  const tags = parsed.data.tags === undefined ? order.tags : normalizeTags(parsed.data.tags, "An order");
  const [row] = await db.update(schema.orders).set({ staffNote, tags, updatedAt: new Date() }).where(eq(schema.orders.id, order.id)).returning();
  return row!;
}

/** Every tag on the store's orders, most used first, to filter the order list. */
export async function orderTags(db: Db, shopId: string) {
  const rows = await db
    .select({ tag: sql<string>`jsonb_array_elements_text(${schema.orders.tags})`.as("tag") })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), sql`jsonb_array_length(${schema.orders.tags}) > 0`));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 50);
}

export async function getOrder(db: Db, shopId: string, orderId: string) {
  const order = await db.query.orders.findFirst({
    where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)),
  });
  if (!order) throw new NotFoundError("Order");
  const [lines, fulfillments, emails] = await Promise.all([
    db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id), orderBy: asc(schema.orderLines.title) }),
    db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id), orderBy: asc(schema.fulfillments.createdAt) }),
    db.query.emails.findMany({ where: eq(schema.emails.orderId, order.id), orderBy: asc(schema.emails.createdAt) }),
  ]);
  return { ...order, lines, fulfillments, emails };
}

/** For the buyer's order status page. */
export async function getOrderByPaymentIntent(db: Db, shopId: string, paymentIntentId: string) {
  const order = await db.query.orders.findFirst({
    where: and(eq(schema.orders.paymentIntentId, paymentIntentId), eq(schema.orders.shopId, shopId)),
  });
  if (!order) throw new NotFoundError("Order");
  return getOrder(db, shopId, order.id);
}
