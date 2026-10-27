import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { z } from "zod";
import { BLOCKED_MESSAGE, blockedMatch } from "./blocklist";
import { tipAmount } from "./tips";
import { blockedItemMessage } from "./country-limits";
import { applyDisputeEvent } from "./disputes";
import { NotFoundError, UserError } from "./errors";
import type { PaymentEvent, PaymentProvider } from "./payments";
import { applyDiscount, automaticOffers, bxgyMissing, describeDiscount, findUsableDiscount, spreadDiscount, type Discount, type OfferUnit } from "./discounts";
import { applyMoneyEvent } from "./payouts";
import { estimateProcessingFee, platformFeeFor } from "./plans";
import { BuiltInTaxCalculator, listTaxRegistrations, type TaxCalculator, type TaxResult } from "./tax";
import { taxExemptionFor } from "./tax-exempt";
import { protectionFee } from "./delivery-protection";
import { presentQuote } from "./currency";
import { creditableCampaign } from "./campaigns";
import { convertAmount, formatMoney, type DisplayFx } from "./money";
import { checkAddress } from "./address-check";
import { breakFor, describeBreak, percentOff, wholesaleTermsFor } from "./wholesale";
import { findGiftCard } from "./gift-cards";
import { bundleSavings, bundlesInCart } from "./bundles";
import { salePrice, salesFor } from "./sales";
import { addonsByProduct, type CheckoutAddon } from "./addons";
import { FREE_GIFT_NOTE, freeGiftFor } from "./free-gift";
import { minimumOrder } from "./min-order";
import { countryName, fitsWeight, listShippingZones, priceRate, zoneFor } from "./shipping";
import { formatWeight } from "./weight";
import { normalizeTags } from "./customers";
import { cartLineKey, cleanPersonalization, missingPersonalization, personalizationValues } from "./personalization";
import { openPreorder, preorderDeadline, preordersSold } from "./preorders";
import { boughtBefore, describeLimitProblem, limitProblem } from "./purchase-limits";
import { onHoliday } from "./store-closure";
import { canPickUp, ownStockOnly, PICKUP_METHOD, PICKUP_RATE_ID } from "./local-pickup";
import { inDeliveryArea, LOCAL_DELIVERY_METHOD, LOCAL_DELIVERY_RATE_ID, localDeliveryPrice } from "./local-delivery";

type Shop = typeof schema.shops.$inferSelect;
type Order = typeof schema.orders.$inferSelect;
/** `custom` is what the buyer typed into a personalised product's fields, by field id. */
export type CartLine = { variantId: string; quantity: number; custom?: Record<string, string> };


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
    /** The buyer's postal code, for the store's own delivery area. */
    postalCode?: string | null;
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
  // The same option can be on several lines with different text; stock counts them together.
  const perVariant = new Map<string, number>();
  for (const l of wanted) perVariant.set(l.variantId, (perVariant.get(l.variantId) ?? 0) + l.quantity);
  // Sold-out options of a product taking pre-orders can still be bought, up to its limit.
  const preorderLeft = new Map<string, number>();
  for (const r of rows) {
    const p = openPreorder(r.product);
    if (p?.limit != null && !preorderLeft.has(r.product.id)) preorderLeft.set(r.product.id, Math.max(0, p.limit - (await preordersSold(db, r.product.id))));
  }
  for (const l of wanted) {
    const productId = rows.find((r) => r.variant.id === l.variantId)?.product.id;
    if (productId) perProduct.set(productId, (perProduct.get(productId) ?? 0) + l.quantity);
  }
  // Purchase limits count every option of a product together. The per-customer one needs to know
  // who's buying: the email at checkout, or the signed-in buyer in the cart.
  const limited = rows.filter((r) => r.product.purchaseLimit);
  const buyer = opts.email ?? opts.buyerEmail;
  const bought = buyer && limited.some((r) => r.product.purchaseLimit!.perCustomer != null)
    ? await boughtBefore(db, shop.id, buyer, [...new Set(limited.map((r) => r.product.id))])
    : new Map<string, number>();
  const limitShown = new Set<string>();
  const items = wanted.map((l) => {
    const row = rows.find((r) => r.variant.id === l.variantId);
    if (!row) throw new UserError("An item in your cart is no longer available.", "unavailable");
    if (!Number.isInteger(l.quantity) || l.quantity > 99) throw new UserError("Quantity must be between 1 and 99.");
    const preorder = row.variant.stock !== null && row.variant.stock < (perVariant.get(l.variantId) ?? l.quantity) ? openPreorder(row.product) : null;
    if (preorder && preorderLeft.has(row.product.id)) {
      const left = preorderLeft.get(row.product.id)!;
      if (left < l.quantity) throw new UserError(left > 0 ? `Only ${left} of ${row.product.title} left to pre-order.` : `Pre-orders for ${row.product.title} are full.`, "unavailable");
      preorderLeft.set(row.product.id, left - l.quantity);
    }
    if (!preorder && row.variant.stock !== null && row.variant.stock < (perVariant.get(l.variantId) ?? l.quantity)) {
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
    const custom = cleanPersonalization(row.product.personalization, l.custom);
    // Shown once, on the product's first line.
    const problem = limitShown.has(row.product.id) ? null : limitProblem(row.product.purchaseLimit, perProduct.get(row.product.id) ?? l.quantity, bought.get(row.product.id) ?? 0);
    if (problem) limitShown.add(row.product.id);
    const limit = problem && { ...problem, product: row.product.title };
    return {
      /** Tells apart lines of the same option with different personalisation; matches the cart line it came from. */
      key: cartLineKey(l),
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
      personalization: personalizationValues(row.product.personalization, custom),
      /** Set (YYYY-MM-DD) when this line is a pre-order: sold out now, promised to ship by then. */
      preorderShipsBy: preorder?.shipsBy ?? null,
      /** Required personalisation fields left empty, by label. Checkout won't start until they're filled. */
      missingPersonalization: missingPersonalization(row.product.personalization, custom),
      /** Too few or too many of this product for its purchase limits. Checkout won't start until it's fixed. */
      limit,
      /** The product's limits, so the cart's quantity box can follow them. */
      purchaseLimit: row.product.purchaseLimit,
      /** Buyers must be this old to buy it, or null. */
      minAge: row.product.minAge,
      /** Countries it can't be shipped to. */
      blockedCountries: giftCard ? [] : row.product.blockedCountries,
    };
  });
  const subtotalMinor = items.reduce((s, i) => s + i.lineMinor, 0);
  // Discounts and shipping only count goods: gift cards are sent by email at face value.
  const goodsMinor = items.filter((i) => !i.giftCard).reduce((s, i) => s + i.lineMinor, 0);
  const hasGoods = items.some((i) => !i.giftCard);
  // What the parcel weighs, for rates that go by weight. Options without a weight count as nothing.
  const weightGrams = items
    .filter((i) => !i.giftCard)
    .reduce((s, i) => s + (rows.find((r) => r.variant.id === i.variantId)?.variant.weightGrams ?? 0) * i.quantity, 0);
  let shippingMinor = 0;
  let shipping: { rateId: string; name: string; minDays: number | null; maxDays: number | null } | null = null;
  let freeShippingOverMinor: number | null = null;
  // Picking up (free) and the store's own delivery are in its own country, when nothing in the
  // cart comes from a supplier. Local delivery also needs the buyer's postal code in its area.
  const onShelf = rows.filter((r) => !r.product.giftCard && wanted.some((l) => l.variantId === r.variant.id)).map((r) => r.product);
  const nearby = hasGoods && (opts.country ?? shop.country) === shop.country;
  const pickupHere = nearby && canPickUp(shop, onShelf);
  const pickingUp = pickupHere && opts.shippingRateId === PICKUP_RATE_ID;
  const area = shop.localDeliveryArea;
  const ownStock = hasGoods && ownStockOnly(onShelf);
  const deliveryHere = nearby && !!area && ownStock && inDeliveryArea(area, opts.postalCode);
  const deliveringLocally = deliveryHere && opts.shippingRateId === LOCAL_DELIVERY_RATE_ID;
  if (hasGoods) {
    const { zones } = await listShippingZones(db, shop.id);
    const hinted = opts.countryHint && zoneFor(zones, opts.countryHint)?.rates.length ? opts.countryHint : null;
    const zoneRates = zoneFor(zones, opts.country ?? hinted ?? shop.country)?.rates ?? [];
    const rates = zoneRates.filter((r) => fitsWeight(r, weightGrams));
    // The lowest amount that makes a paid rate free, unless a rate is free anyway.
    if (!rates.some((r) => r.priceMinor === 0)) {
      const over = rates.map((r) => r.freeOverMinor).filter((m): m is number => m !== null);
      if (over.length) freeShippingOverMinor = Math.min(...over);
    }
    if (pickingUp) {
      shipping = { rateId: PICKUP_RATE_ID, name: PICKUP_METHOD, minDays: null, maxDays: null };
      freeShippingOverMinor = null;
    }
    if (deliveringLocally) {
      shippingMinor = localDeliveryPrice(area!, goodsMinor);
      shipping = { rateId: LOCAL_DELIVERY_RATE_ID, name: LOCAL_DELIVERY_METHOD, minDays: null, maxDays: null };
      freeShippingOverMinor = shippingMinor ? area!.freeOverMinor : null;
    }
    if (!rates.length && opts.country && !pickingUp && !deliveringLocally) {
      if (zoneRates.length) throw new UserError(`${shop.name} has no shipping for an order this heavy (${formatWeight(weightGrams)}) to ${countryName(opts.country)}. Try fewer items, or split the order.`, "no_shipping");
      throw new UserError(`${shop.name} doesn't ship to ${countryName(opts.country)} yet.`, "no_shipping");
    }
    // The rate the buyer picked, or the cheapest for this cart. Picking up is only ever chosen.
    const rate = pickingUp || deliveringLocally ? undefined : (rates.find((r) => r.id === opts.shippingRateId) ?? [...rates].sort((a, b) => priceRate(a, goodsMinor) - priceRate(b, goodsMinor))[0]);
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
  /** The next "Spend more, save more" step: how much more to spend, and what it takes off (a percent or an amount). */
  let spendNudge = null as { moreMinor: number; kind: "percent" | "amount"; value: number } | null;
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
    const offers = await automaticOffers(db, shop.id);
    const tiers: Discount[] = [];
    for (const d of offers) {
      try {
        await findUsableDiscount(db, shop, d.code, { subtotalMinor: goodsMinor, email: opts.email });
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        if (d.kind !== "bxgy" && goodsMinor < d.minSubtotalMinor) tiers.push(d);
        continue;
      }
      const applied = applyDiscount(d, goodsMinor, shippingMinor, units);
      if (applied.discountMinor > (best?.applied.discountMinor ?? 0)) best = { d, applied };
      const missing = bxgyMissing(d, units);
      if (missing && !offerNudge) offerNudge = { label: describeDiscount(d, shop.currency), missing, free: d.value >= 100 };
    }
    if (best && !(bundle && bundle.discountMinor >= best.applied.discountMinor)) use(best.d, best.applied);
    // The nearest step up that would save more than what the cart gets now.
    const now = discount?.discountMinor ?? bundle?.discountMinor ?? 0;
    const next = tiers
      .filter((d) => applyDiscount(d, d.minSubtotalMinor, shippingMinor).discountMinor > now)
      .sort((a, b) => a.minSubtotalMinor - b.minSubtotalMinor)[0];
    if (next) spendNudge = { moreMinor: next.minSubtotalMinor - goodsMinor, kind: next.kind as "percent" | "amount", value: next.value };
  }
  const discountMinor = discount?.discountMinor ?? bundle?.discountMinor ?? 0;
  const totalMinor = subtotalMinor - discountMinor + shippingMinor;
  const freeGift = wholesale || !hasGoods ? null : await freeGiftFor(db, shop, goodsMinor - discountMinor, opts.country ?? null);
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
    spendNudge,
    /** The store's free gift: added to the order once `unlocked`, else how much more it takes. */
    freeGift,
    /** The store's smallest order and how far the goods are from it. Null when it has none, or for gift cards alone and wholesale. */
    minimumOrder: wholesale || !hasGoods ? null : minimumOrder(shop, goodsMinor - discountMinor),
    discountMinor,
    shippingMinor,
    totalMinor,
    goodsMinor,
    /** What the goods weigh in grams, from their options' weights. 0 when none are set. */
    weightGrams,
    /** The oldest age any item asks for: checkout needs the buyer to confirm it. Null when none do. */
    minAge: items.reduce<number | null>((m, i) => (i.minAge !== null && (m === null || i.minAge > m) ? i.minAge : m), null),
    /** The rate used. Null when nothing needs shipping, or the cart's estimate country has no zone. */
    shipping,
    /** The buyer can pick this cart up from the store instead (see local-pickup.ts). */
    canPickUp: pickupHere,
    /** They chose to. */
    pickingUp,
    /** Everything that ships is the store's own stock (not from a supplier). */
    ownStock,
    /** The store can deliver this cart itself to the buyer's postal code. */
    canDeliverLocally: deliveryHere,
    /** They chose it. */
    deliveringLocally,
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
  phone: z.string().trim().max(30, "Check the phone number.").optional().transform((p) => p || undefined),
})
  // A postal code in the wrong shape is the usual reason a parcel comes back; ask while the buyer is here.
  .transform((a, ctx) => {
    const checked = checkAddress(a);
    if (checked.problem) {
      ctx.addIssue({ code: "custom", message: checked.problem.message, path: [checked.problem.field] });
      return z.NEVER;
    }
    return checked.address;
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
    /**
     * A repeat delivery for a subscription: its percent off, no codes, shipping as usual. Created
     * unpaid; the caller charges the saved card.
     */
    subscription?: { id: string; percentOff: number };
    /** The buyer is on the store's checkout page, so the store's phone setting applies. */
    storefront?: boolean;
    /**
     * Whose tax exemption applies when nobody is signed in: set only by the merchant's own tools
     * (a payment link they built), never from a form the buyer fills in.
     */
    taxExemptFor?: string | null;
    /** The buyer ticked delivery protection, where the store offers it. */
    protection?: boolean;
    /** The buyer asked for the gift to be wrapped, where the store wraps. */
    giftWrap?: boolean;
    /** The buyer ticked "I'm N or older" for age-restricted items. */
    ageConfirmed?: boolean;
    /** The tip percentage the buyer picked at checkout, from the store's choices. */
    tipPercent?: number | null;
  },
  taxCalculator: TaxCalculator = new BuiltInTaxCalculator(),
) {
  if (shop.status !== "active") throw new UserError("This store isn't taking orders right now.", "shop_inactive");
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { email } = parsed.data;
  let { address } = parsed.data;
  if (input.storefront) {
    if (shop.checkoutPhone === "off") address = { ...address, phone: undefined };
    else if (shop.checkoutPhone === "required" && !address.phone) throw new UserError("Enter a phone number for the courier.", "phone_missing");
  }
  const gift = parsed.data.gift ?? null;
  const followUp = input.followUp ?? null;
  const repeat = input.subscription ?? null;
  // On a holiday break only orders already agreed to carry on: repeat deliveries and after-checkout offers.
  if (!followUp && !repeat && onHoliday(shop)) throw new UserError("This store is on a break and isn't taking orders right now.", "shop_holiday");
  const noCodes = !!followUp || !!repeat;
  // Buyers the store blocked (chargebacks, stolen cards) are turned away before any payment.
  if (!followUp && !repeat && (await blockedMatch(db, shop.id, { email, address }))) throw new UserError(BLOCKED_MESSAGE, "buyer_blocked");
  const quoted = await quoteCart(db, shop, input.lines, {
    discountCode: noCodes ? null : input.discountCode,
    email,
    buyerEmail: noCodes ? null : input.buyerEmail,
    giftCardCode: noCodes ? null : input.giftCardCode,
    country: address.country,
    postalCode: address.postalCode,
    shippingRateId: input.shippingRateId,
  });
  const cart = followUp ? asFollowUp(quoted, followUp.percentOff) : repeat ? asFollowUp(quoted, repeat.percentOff, { keepShipping: true }) : quoted;
  const unfinished = quoted.items.find((i) => i.missingPersonalization.length);
  if (unfinished) {
    throw new UserError(`Add ${unfinished.missingPersonalization.join(" and ")} for ${unfinished.title} before checking out.`, "personalization_missing");
  }
  // Some things can't go to some countries (batteries, knives); say so before anyone pays.
  const cantGo = blockedItemMessage(quoted.items, address.country);
  if (cantGo) throw new UserError(cantGo, "product_country");
  // Repeat deliveries keep going; the buyer signed up for them.
  // Age-restricted items need the buyer to say they're old enough, on the store's own checkout.
  // Repeat deliveries and after-checkout offers follow an order where they already did.
  if (input.storefront && !followUp && !repeat && quoted.minAge !== null && !input.ageConfirmed) {
    const item = quoted.items.find((i) => i.minAge === quoted.minAge)!;
    throw new UserError(`Confirm you're ${quoted.minAge} or older to buy ${item.title}.`, "age_unconfirmed");
  }
  const overLimit = repeat ? null : quoted.items.find((i) => i.limit);
  if (overLimit) throw new UserError(describeLimitProblem(overLimit.limit!, overLimit.limit!.product), "purchase_limit");
  if (cart.wholesale && cart.wholesale.shortByMinor > 0) {
    throw new UserError(
      `Wholesale orders start at ${formatMoney(cart.wholesale.minOrderMinor, shop.currency)}. Add ${formatMoney(cart.wholesale.shortByMinor, shop.currency)} more to check out.`,
      "wholesale_minimum",
    );
  }
  // The store's smallest order applies on its own checkout, not to payment links the merchant builds.
  if (input.storefront && cart.minimumOrder && cart.minimumOrder.shortByMinor > 0) {
    throw new UserError(
      `${shop.name} takes orders of ${formatMoney(cart.minimumOrder.minMinor, shop.currency)} or more. Add ${formatMoney(cart.minimumOrder.shortByMinor, shop.currency)} more to check out.`,
      "below_minimum",
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
  // A tax-exempt buyer pays none, when signed in. Repeat deliveries and after-checkout offers
  // follow the order they came from. Where prices include tax, they pay the price as shown.
  const taxExemptId = followUp
    ? ((await db.query.orders.findFirst({ where: eq(schema.orders.id, followUp.parentOrderId), columns: { taxExemptId: true } }))?.taxExemptId ?? null)
    : repeat
      ? await subscriptionExemption(db, repeat.id)
      : await taxExemptionFor(db, shop.id, input.buyerEmail ?? input.taxExemptFor);
  const tax: TaxResult = taxExemptId ? { taxMinor: 0, included: shop.pricesIncludeTax, breakdown: [], calculationId: null } : await taxCalculator.calculate({
    currency: cart.currency,
    lines: cart.items.map((i, n) => ({ reference: i.variantId, amountMinor: taxed[n]! })),
    shippingMinor: cart.shippingMinor,
    address,
    pricesIncludeTax: shop.pricesIncludeTax,
    accountId: shop.paymentsAccountId,
    registrations: (await listTaxRegistrations(db, shop.id)).map((r) => r.jurisdiction),
  });
  // Protection is the buyer's own choice at checkout; repeat deliveries and offers never add it.
  // Nothing goes by courier on an order picked up or delivered by the store, so there's nothing to protect.
  const protectionMinor =
    shop.deliveryProtection && input.protection && !followUp && !repeat && !cart.pickingUp && !cart.deliveringLocally ? protectionFee(shop.deliveryProtection, cart.goodsMinor - cart.discountMinor) : 0;
  // Wrapping is for gifts with something to wrap, at the store's price; never on repeats or offers.
  const giftWrapMinor = shop.giftWrap && input.giftWrap && gift && cart.items.some((i) => !i.giftCard) && !followUp && !repeat ? shop.giftWrap.priceMinor : 0;
  // A tip is only asked for on the store's own checkout, at one of its own percentages.
  const tipping = input.storefront && !followUp && !repeat && input.tipPercent ? shop.tipping : null;
  if (tipping && !tipping.percents.includes(input.tipPercent!)) throw new UserError("Pick one of the tip amounts shown.", "tip_invalid");
  const tipMinor = tipping ? tipAmount(cart.goodsMinor - cart.discountMinor, input.tipPercent!) : 0;
  const quote = {
    ...cart,
    protectionMinor,
    giftWrapMinor,
    tipMinor,
    taxMinor: tax.taxMinor,
    taxIncluded: tax.included,
    taxBreakdown: tax.breakdown,
    totalMinor: cart.subtotalMinor - cart.discountMinor + cart.shippingMinor + protectionMinor + giftWrapMinor + tipMinor + (tax.included ? 0 : tax.taxMinor),
  };
  const giftCardMinor = cart.giftCard ? Math.min(cart.giftCard.balanceMinor, quote.totalMinor) : 0;
  const dueMinor = quote.totalMinor - giftCardMinor;
  // Our fee is on the sale, not on tax the merchant passes on to the government, and not on the
  // part paid with a gift card: the fee was taken when the gift card was sold. Tips are all the store's.
  const platformFeeMinor = platformFeeFor(shop.plan, Math.max(0, quote.totalMinor - quote.taxMinor - giftCardMinor - tipMinor));
  const presentment = fx ? presentQuote({ ...quote, pricesIncludeTax: tax.included }, fx) : null;

  // The card is kept for the after-checkout offer and subscriptions, in the store's currency only.
  const saveCard = !noCodes && !fx && !!dueMinor && (!!shop.postPurchaseOffer?.active || !!shop.subscriptionOffer?.active);
  // Paid in full by gift card: there's nothing to charge, so the order is paid right away. An
  // after-checkout order or repeat delivery is charged to the saved card by the caller once it exists.
  const intent = noCodes
    ? { id: `${followUp ? "followup" : "subscription"}_${randomUUID()}`, clientSecret: "" }
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
        protectionMinor,
        giftWrapMinor,
        tipMinor,
        ageConfirmed: quoted.minAge !== null && input.ageConfirmed ? quoted.minAge : null,
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
        pickup: cart.pickingUp,
        localDelivery: cart.deliveringLocally,
        // Only something that ships can be a gift; gift cards are emailed to the buyer.
        gift: gift && cart.items.some((i) => !i.giftCard) ? gift : null,
        buyerNote: parsed.data.note,
        taxExemptId,
        ...(followUp ? { source: "post_purchase" as const, parentOrderId: followUp.parentOrderId } : {}),
        ...(repeat ? { source: "subscription" as const, subscriptionId: repeat.id } : {}),
        cardSaved: saveCard,
        // The latest ship-by date of anything pre-ordered: the order waits for it.
        preorderShipsBy: quote.items.reduce<Date | null>((latest, i) => {
          if (!i.preorderShipsBy) return latest;
          const d = preorderDeadline({ shipsBy: i.preorderShipsBy, limit: null });
          return !latest || d > latest ? d : latest;
        }, null),
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
        personalization: i.personalization,
        preorder: !!i.preorderShipsBy,
      })),
    );
    // The free gift goes out with the order at no charge, so its stock and cost count like any line.
    const freeGift = quote.freeGift?.unlocked ? quote.freeGift : null;
    if (freeGift) {
      await tx.insert(schema.orderLines).values({
        orderId: order!.id,
        variantId: freeGift.variantId,
        title: `${freeGift.title} (${FREE_GIFT_NOTE})`,
        quantity: 1,
        unitPriceMinor: 0,
        unitCostMinor: freeGift.unitCostMinor,
      });
    }
    return order!;
  });

  return { order, clientSecret: intent.clientSecret, quote, paidWithGiftCard: !dueMinor };
}

/** An after-checkout offer's prices: its percent off each item, no codes or offers, no shipping. */
function asFollowUp(cart: Awaited<ReturnType<typeof quoteCart>>, percent: number, opts: { keepShipping?: boolean } = {}) {
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
    shippingMinor: opts.keepShipping ? cart.shippingMinor : 0,
    shipping: opts.keepShipping ? cart.shipping : null,
    giftCard: null,
    wholesale: null,
    offerNudge: null,
    spendNudge: null,
    freeGift: null,
    minimumOrder: null,
    freeShipping: null,
    totalMinor: subtotalMinor + (opts.keepShipping ? cart.shippingMinor : 0),
    dueMinor: subtotalMinor + (opts.keepShipping ? cart.shippingMinor : 0),
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

    if (event.type === "dispute.updated") {
      const dispute = await applyDisputeEvent(tx as unknown as Db, event.dispute);
      await tx.update(schema.webhookEvents).set({ processedAt: new Date() }).where(eq(schema.webhookEvents.id, event.id));
      return dispute ? { status: "processed" as const, becamePaid: false as const, disputeShopId: dispute.shopId } : { status: "unknown_order" as const };
    }

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
  filter: { fulfillmentStatus?: Order["fulfillmentStatus"]; held?: boolean; tag?: string; query?: string; from?: Date; to?: Date } = {},
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
      // Placed in this range (from inclusive, to exclusive).
      filter.from ? gte(schema.orders.createdAt, filter.from) : undefined,
      filter.to ? lt(schema.orders.createdAt, filter.to) : undefined,
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

/** The exemption on the order a subscription started from. */
async function subscriptionExemption(db: Db, subscriptionId: string) {
  const [row] = await db
    .select({ taxExemptId: schema.orders.taxExemptId })
    .from(schema.subscriptions)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.subscriptions.firstOrderId))
    .where(eq(schema.subscriptions.id, subscriptionId));
  return row?.taxExemptId ?? null;
}
