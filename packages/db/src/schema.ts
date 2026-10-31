// Milestone 1 to 34 tables. Full target schema from the plan: ../schema-target.sql.
// Money is integer minor units plus a currency. Times are timestamptz.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  customType,
  date,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  char,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "number" });

// Development auth. In production this is replaced by Supabase Auth (auth.users).
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  // Push notification kinds this person turned off in the app (see PUSH_KINDS).
  pushOff: jsonb("push_off").$type<string[]>().notNull().default([]),
  // Two-step sign-in: a code from an authenticator app after the password. The secret is saved
  // when setup starts and only counts once two_step_on_at is set; the last time step used stops a
  // code being used twice. Recovery codes are kept hashed and each works once.
  twoStepSecret: text("two_step_secret"),
  twoStepOnAt: timestamp("two_step_on_at", { withTimezone: true }),
  twoStepLastStep: integer("two_step_last_step"),
  recoveryCodes: jsonb("recovery_codes").$type<string[]>().notNull().default([]),
  // Devices ("Chrome on Mac") this person has signed in on, so a sign-in from a new one is emailed.
  knownDevices: jsonb("known_devices").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // What the person signed in on ("Chrome on Mac", "Merchant app"), and when it was last used
    // (updated at most every few minutes), for the list of devices on Your account.
    device: text("device"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * cost × multiplier, or cost + fixed amount; then rounded up to end in .99, .95 or .00 (or left
 * exact); an optional "was" price a percentage higher shows as a crossed-out price.
 */
/** A personal one-time code emailed to each new signup. Null on the shop means it's off. */
export type WelcomeOffer = { percentOff: number; minSubtotalMinor: number; days: number };
/** Email a code `afterDays` after a subscriber's last order; the code lasts `days`. */
export type WinbackOffer = { afterDays: number; percentOff: number; days: number };
export type BirthdayOffer = { percentOff: number; days: number };

/** One product offered on the order page right after paying, added with one click to the same card. */
export type PostPurchaseOffer = { productId: string; percentOff: number; active: boolean };
/** "Subscribe and save": after paying, buyers can have the same items sent again on a schedule, for less. */
export type SubscriptionOffer = { percentOff: number; active: boolean };

/** The risk check run when an order is paid. Reasons are written for the merchant. */
export type OrderRisk = { level: "low" | "medium" | "high"; score: number; reasons: string[]; checkedAt: string };
/**
 * Refer a friend: a buyer shares their link, the friend gets a one-time percentage off a first
 * order, and the buyer gets store credit once that order is delivered. Null on the shop means off.
 */
export type ReferralProgram = { friendPercentOff: number; rewardMinor: number; minSubtotalMinor: number };
/** Which risky orders wait for the merchant before going to the supplier. */
export type RiskHold = "off" | "medium" | "high";
/** A change made to many products at once from the Products list. */
export type BulkEditAction =
  | { kind: "status"; status: "draft" | "active" | "archived" }
  | { kind: "price"; percent: number; ending: "99" | "95" | "00" | "none" }
  | { kind: "compare_at"; percent: number | null }
  | { kind: "collection"; collectionId: string; remove: boolean }
  | { kind: "tag"; tag: string; remove: boolean };
/** What a bulk edit replaced, and what it set, so it can be undone without losing later edits. */
export type BulkEditSnapshot = {
  products: { id: string; status: "draft" | "active" | "archived" }[];
  variants: { id: string; priceMinor: number; compareAtMinor: number | null; newPriceMinor: number; newCompareAtMinor: number | null }[];
  collection: { collectionId: string; productId: string; wasIn: boolean }[];
  /** Edits from before tags could be changed in bulk don't have this. */
  tags?: { productId: string; tag: string; had: boolean }[];
};

export type PricingRule = { kind: "multiplier" | "fixed"; value: number; ending: "99" | "95" | "00" | "none"; compareAtPercent: number | null; minPriceMinor: number };

/** A search that shows another search's results instead, both as the store counts them. */
export type SearchFix = { from: string; to: string };

/** Sold-out products in lists: where they are, after everything that can be bought, or not at all. */
export const SOLD_OUT_DISPLAY = ["show", "last", "hide"] as const;
export type SoldOutDisplay = (typeof SOLD_OUT_DISPLAY)[number];

export const shops = pgTable(
  "shops",
  {
    id: id(),
    name: text("name").notNull(),
    handle: text("handle").notNull().unique(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    country: char("country", { length: 2 }).notNull(),
    status: text("status", { enum: ["active", "paused", "under_review", "suspended", "closed"] })
      .notNull()
      .default("active"),
    statusReason: text("status_reason"),
    paymentsAccountId: text("payments_account_id").unique(),
    // Payout account status, mirrored from the payment provider (Stripe Connect).
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    plan: text("plan", { enum: ["free", "starter", "growth", "scale"] }).notNull().default("free"),
    billingCustomerId: text("billing_customer_id").unique(),
    billingSubscriptionId: text("billing_subscription_id").unique(),
    // UK and EU buyers expect prices with VAT included; US and Canadian prices show tax on top.
    pricesIncludeTax: boolean("prices_include_tax").notNull().default(false),
    // Set while the store meets the verified-store checklist; shown as a badge on the storefront.
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // AI settings. Budget in minor units of USD per calendar month; null means the plan's default.
    aiBudgetMinor: integer("ai_budget_minor"),
    // Kinds of buyer question the support agent may answer without the merchant checking first.
    aiAutoReplyTopics: jsonb("ai_auto_reply_topics").$type<string[]>().notNull().default([]),
    // Let the margin agent pause a product that loses money without asking first.
    aiAutoPause: boolean("ai_auto_pause").notNull().default(false),
    // Remind buyers who started checkout but didn't pay (one email, an hour later).
    abandonedCartEmails: boolean("abandoned_cart_emails").notNull().default(true),
    // Email subscribers who looked at a product while signed in and didn't buy it ("Still thinking it over?").
    browseReminders: boolean("browse_reminders").notNull().default(false),
    // A phone number at checkout, for the courier: not asked, optional, or required.
    checkoutPhone: text("checkout_phone", { enum: ["off", "optional", "required"] }).notNull().default("optional"),
    // A second checkout reminder, a day after the first, with a one-time code. Null means off.
    abandonedCartOffer: jsonb("abandoned_cart_offer").$type<AbandonedCartOffer | null>(),
    // Delivery protection buyers can add at checkout, or null when the store doesn't offer it.
    deliveryProtection: jsonb("delivery_protection").$type<DeliveryProtection | null>(),
    // Show new reviews straight away instead of waiting for the merchant.
    reviewsAutoPublish: boolean("reviews_auto_publish").notNull().default(false),
    // Buyers are emailed asking for a review this many days after their order arrives; 0 turns it off.
    reviewRequestDays: integer("review_request_days").notNull().default(7),
    // A thank-you code for a review: this percent off the buyer's next order, once per order. Null means off.
    reviewRewardPercent: integer("review_reward_percent"),
    // One more email a week after the review request, for buyers who haven't reviewed yet.
    reviewReminder: boolean("review_reminder").notNull().default(false),
    // Buyers whose order still hasn't shipped this many days after paying get one email saying so.
    lateOrderNotice: jsonb("late_order_notice").$type<LateOrderNotice | null>(),
    // Extra currencies buyers can shop in, converted from the store's own currency at today's rate.
    presentmentCurrencies: jsonb("presentment_currencies").$type<string[]>().notNull().default([]),
    // Round converted prices up to end in .99 (shipping and tax are never rounded).
    roundConvertedPrices: boolean("round_converted_prices").notNull().default(true),
    // Printed at the foot of marketing emails, as anti-spam law requires.
    mailingAddress: text("mailing_address"),
    // Printed at the foot of packing slips, like a thank-you or a code for next time.
    packingSlipNote: text("packing_slip_note"),
    // Buyers in the store's country can pick up orders of its own stock here, or null when it doesn't offer it.
    localPickup: jsonb("local_pickup").$type<LocalPickup | null>(),
    // The store delivers its own stock itself to these postal codes, for a fee, or null when it doesn't.
    localDeliveryArea: jsonb("local_delivery_area").$type<LocalDeliveryArea | null>(),
    // Buyers picking up or getting a local delivery choose one of these days at checkout, or null when they don't choose.
    handoverDays: jsonb("handover_days").$type<HandoverDays | null>(),
    // Gift wrapping buyers can add to a gift at checkout, or null when the store doesn't wrap.
    giftWrap: jsonb("gift_wrap").$type<GiftWrap | null>(),
    // The smallest order the store takes, in goods after discounts; 0 means any amount.
    minOrderMinor: money("min_order_minor").notNull().default(0),
    // One option given free with orders over an amount ("Free tote over $75"), or null when there's none.
    freeGift: jsonb("free_gift").$type<FreeGift | null>(),
    // Buyers may pay by bank transfer to these details, within so many days, or null when they can't.
    bankTransfer: jsonb("bank_transfer").$type<BankTransfer | null>(),
    // Orders in by this hour (store time) start that shipping day, or null when there's no cutoff.
    shipCutoff: jsonb("ship_cutoff").$type<ShipCutoff | null>(),
    // "Order by Dec 15 to get it in time for Christmas": a day orders must arrive by, or null.
    holidayDeadline: jsonb("holiday_deadline").$type<HolidayDeadline | null>(),
    // The tip percentages buyers can pick at checkout, or null when the store doesn't ask.
    tipping: jsonb("tipping").$type<Tipping | null>(),
    // "How did you hear about us?" asked on the order page after paying. Null when it's off.
    survey: jsonb("survey").$type<BuyerSurvey | null>(),
    // Wholesale: approved business buyers pay this much less, on orders of at least the minimum.
    wholesaleEnabled: boolean("wholesale_enabled").notNull().default(false),
    wholesalePercentOff: integer("wholesale_percent_off").notNull().default(20),
    wholesaleMinOrderMinor: money("wholesale_min_order_minor").notNull().default(0),
    // Buyers can ask for a return this many days after delivery; 0 turns the form off.
    returnWindowDays: integer("return_window_days").notNull().default(30),
    returnInstructions: text("return_instructions"),
    // Longer returns for orders paid in a holiday stretch ("Nov 1 to Dec 24, returnable until Jan 31"), or null.
    holidayReturns: jsonb("holiday_returns").$type<HolidayReturns | null>(),
    // "A $10 bonus card for every $50 in gift cards" while the dates last, or null.
    giftCardBonus: jsonb("gift_card_bonus").$type<GiftCardBonus | null>(),
    // A few questions that point buyers to products by tag ("Who's it for?"), or null.
    productQuiz: jsonb("product_quiz").$type<ProductQuiz | null>(),
    // How supplier cost becomes a retail price, for imports and "reprice everything".
    pricingRule: jsonb("pricing_rule").$type<PricingRule>(),
    // Supplier price watch: warn when a cost rise leaves less than this margin, and optionally
    // raise the price with the pricing rule straight away.
    minMarginPercent: integer("min_margin_percent").notNull().default(20),
    autoReprice: boolean("auto_reprice").notNull().default(false),
    // Languages the store is also shown in, besides English, like ["de", "fr"]. Buyers pick one
    // in the footer; each has its own address (/de/...).
    languages: jsonb("languages").$type<string[]>().notNull().default([]),
    // Rewards: buyers earn points on what they pay and swap them for store credit.
    rewardsEnabled: boolean("rewards_enabled").notNull().default(false),
    /** Points per 1.00 spent. */
    rewardsEarnRate: integer("rewards_earn_rate").notNull().default(1),
    /** What 100 points are worth, in minor units. */
    rewardsValueMinor: integer("rewards_value_minor").notNull().default(100),
    // Invoices: the seller details printed on them, and the next number in the store's one series
    // (invoices and credit notes share it, so there are no gaps).
    invoiceLegalName: text("invoice_legal_name"),
    invoiceAddress: text("invoice_address"),
    invoicePrefix: text("invoice_prefix").notNull().default("INV-"),
    invoiceNextNumber: integer("invoice_next_number").notNull().default(1),
    invoiceFooter: text("invoice_footer"),
    welcomeOffer: jsonb("welcome_offer").$type<WelcomeOffer>(),
    // Win-back emails: a personal code for subscribers who haven't ordered in a while. Null when off.
    winbackOffer: jsonb("winback_offer").$type<WinbackOffer>(),
    // Birthday codes: subscribers who gave their birthday get a code of their own that day. Null when off.
    birthdayOffer: jsonb("birthday_offer").$type<BirthdayOffer>(),
    // The sign-up pop-up: shown once to new visitors this many seconds after they arrive. Null when off.
    signupPopupSeconds: integer("signup_popup_seconds"),
    // The store's own words for buyers who just paid, on the order page and in the confirmation email.
    thankYouNote: text("thank_you_note"),
    // A floating chat button on the store: a WhatsApp number (digits) and/or a Telegram username.
    chatButtons: jsonb("chat_buttons").$type<ChatButtons>(),
    holdRiskyOrders: text("hold_risky_orders", { enum: ["off", "medium", "high"] }).notNull().default("high"),
    postPurchaseOffer: jsonb("post_purchase_offer").$type<PostPurchaseOffer>(),
    subscriptionOffer: jsonb("subscription_offer").$type<SubscriptionOffer>(),
    // Delivery dates on product pages, order pages and receipts: the days to get an order to the
    // supplier and out the door, then the slower of the supplier's and the shipping rate's transit.
    deliveryEstimates: boolean("delivery_estimates").notNull().default(true),
    processingDays: integer("processing_days").notNull().default(2),
    referralProgram: jsonb("referral_program").$type<ReferralProgram>(),
    // Product pages say "Only 3 left" when an option's real stock is at or below this; 0 turns it off.
    lowStockNote: integer("low_stock_note").notNull().default(5),
    // The team is emailed when an option of a product added by hand has this many or fewer left; 0 turns it off.
    restockAlertAt: integer("restock_alert_at").notNull().default(3),
    // Buyers can cancel a paid order from its page in the first hours, until it ships, for a full refund.
    buyerCancel: boolean("buyer_cancel").notNull().default(true),
    // Ad tracking: Meta, TikTok and Google tags, and which visitors are asked before they load.
    adPixels: jsonb("ad_pixels").$type<AdPixels>(),
    cookieConsent: text("cookie_consent", { enum: ["everyone", "eu_uk"] }).notNull().default("everyone"),
    // A password page before launch, or a holiday break. Null when the store is open.
    closure: jsonb("closure").$type<StoreClosure>(),
    productBadges: jsonb("product_badges").$type<BadgeSettings>().notNull().default({ sale: true, soldOut: true, newDays: 0 }),
    // An "Add to cart" button on product cards, for products with nothing to choose.
    cardQuickAdd: boolean("card_quick_add").notNull().default(true),
    // After "Add to cart", stay on the page with a note instead of opening the cart.
    stayAfterAdd: boolean("stay_after_add").notNull().default(false),
    // Fold-out notes under every product's description: shipping, returns, care. Up to four.
    productInfo: jsonb("product_info").$type<ProductInfoBlock[]>().notNull().default([]),
    // Share buttons on product pages: copy the link, WhatsApp, Facebook and Pinterest.
    shareButtons: boolean("share_buttons").notNull().default(true),
    // "12 sold in the last 7 days" on product pages, from real paid orders. Off until the merchant turns it on.
    recentSales: boolean("recent_sales").notNull().default(false),
    // Where sold-out products go in collections, search and the home page.
    soldOutProducts: text("sold_out_products", { enum: SOLD_OUT_DISPLAY }).notNull().default("last"),
    // Searches the merchant pointed elsewhere: "lampshade" shows the results for "lamp shade".
    searchFixes: jsonb("search_fixes").$type<SearchFix[]>().notNull().default([]),
    // "Lowest price in the 30 days before the discount" next to reduced prices: the EU's rule.
    lowestPriceNote: text("lowest_price_note", { enum: ["eu", "everyone", "off"] }).notNull().default("eu"),
    // The Monday summary email: the week (its Monday, YYYY-MM-DD) it was last sent for.
    weeklySummaryFor: text("weekly_summary_for"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shops_handle_format", sql`${t.handle} ~ '^[a-z0-9](-?[a-z0-9])*$'`),
    check("shops_reason_when_not_active", sql`${t.status} = 'active' or ${t.statusReason} is not null`),
    check("shops_wholesale_percent", sql`${t.wholesalePercentOff} between 1 and 80`),
  ],
);

export const shopMembers = pgTable(
  "shop_members",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "staff"] }).notNull().default("owner"),
    // Gets the Monday summary of this store, for those who can see its money. On unless turned off.
    weeklySummary: boolean("weekly_summary").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.userId] }), index("shop_members_user_idx").on(t.userId)],
);

// A supplier connection for one store. Credentials live in a secret store; only a pointer is kept here.
// "email" is one of the merchant's own suppliers: orders reach it by email and it adds tracking
// through a private link (portal_token), so any supplier works without an API.
export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["fake", "cj", "aliexpress", "email"] }).notNull(),
    credentialsRef: text("credentials_ref"),
    status: text("status", { enum: ["connected", "error", "disconnected"] }).notNull().default("connected"),
    name: text("name"),
    contactEmail: text("contact_email"),
    portalToken: text("portal_token")
      .notNull()
      .unique()
      .default(sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`),
    createdAt: createdAt(),
  },
  (t) => [
    // One link per API supplier; own suppliers are told apart by their email.
    unique("suppliers_shop_provider_contact_uq").on(t.shopId, t.provider, t.contactEmail).nullsNotDistinct(),
    check("suppliers_email_has_contact", sql`${t.provider} <> 'email' or (${t.contactEmail} is not null and ${t.name} is not null)`),
  ],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    descriptionHtml: text("description_html").notNull().default(""),
    /** The cover photo, kept equal to images[0] so lists and emails need only one field. */
    imageUrl: text("image_url"),
    /** Every photo in order, cover first. */
    images: jsonb("images").$type<string[]>().notNull().default([]),
    /** What each photo shows, by its address, for screen readers and image search. */
    imageAlts: jsonb("image_alts").$type<Record<string, string>>().notNull().default({}),
    status: text("status", { enum: ["draft", "active", "archived"] }).notNull().default("draft"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    supplierProductRef: text("supplier_product_ref"),
    sourceUrl: text("source_url"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    // Suggested next to this product and in the cart ("Goes well with").
    upsellProductId: uuid("upsell_product_id").references((): AnyPgColumn => products.id, { onDelete: "set null" }),
    // Quantity discounts, e.g. [{ minQty: 2, percentOff: 10 }, { minQty: 5, percentOff: 15 }].
    quantityBreaks: jsonb("quantity_breaks").$type<QuantityBreak[]>().notNull().default([]),
    // Text the buyer types before adding to cart, like a name to engrave.
    personalization: jsonb("personalization").$type<PersonalizationField[]>().notNull().default([]),
    // Pre-orders: sold-out options can still be bought, promised to ship by this date.
    preorder: jsonb("preorder").$type<Preorder>(),
    // Least and most a buyer can order, e.g. a limited drop capped at 2 per customer.
    purchaseLimit: jsonb("purchase_limit").$type<PurchaseLimit>(),
    // For customs forms on orders that cross a border: the tariff code and where it was made.
    hsCode: text("hs_code"),
    originCountry: text("origin_country"),
    // Buyers must say they're at least this old to check out with it (alcohol, vapes, knives).
    minAge: integer("min_age"),
    // Countries it can't be shipped to (batteries, knives, a supplier that doesn't go there).
    blockedCountries: jsonb("blocked_countries").$type<string[]>().notNull().default([]),
    // The colour each value of its colour option shows as on the store ({"Sage": "#9caf88"}), where the name alone doesn't say.
    swatches: jsonb("swatches").$type<Record<string, string>>().notNull().default({}),
    // How many days the product usually lasts, for the one "running low?" email; null means no reminder.
    reorderDays: integer("reorder_days"),
    // A video for the product page: a YouTube or Vimeo link, or an https video file.
    videoUrl: text("video_url"),
    // Facts shown as a table on the product page, like Material: Aluminium or Size: 20 × 10 cm.
    details: jsonb("details").$type<ProductDetail[]>().notNull().default([]),
    // A short label of the merchant's own on product cards, like "Bestseller".
    badge: text("badge"),
    // How the product shows in search results; the title and description are used when empty.
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    // A gift card sold on the store: each one bought issues a code worth its variant's price.
    giftCard: boolean("gift_card").notNull().default(false),
    // Sold as a file the buyer downloads (in digital_files): no shipping and no supplier.
    digital: boolean("digital").notNull().default(false),
    // When stock and cost were last read from the supplier; the daily sync starts with the oldest.
    stockCheckedAt: timestamp("stock_checked_at", { withTimezone: true }),
    // A second supplier for this product. Orders go there when the main supplier is out of stock.
    backup: jsonb("backup").$type<ProductBackup>(),
    // When the team was told every option sold out at the supplier. Cleared once it's back.
    soldOutNotifiedAt: timestamp("sold_out_notified_at", { withTimezone: true }),
    // A draft goes on sale by itself at this time. Cleared when it does, or when its status changes.
    publishAt: timestamp("publish_at", { withTimezone: true }),
    // While it waits for publishAt, the store shows a coming-soon page where shoppers can ask to be emailed.
    comingSoon: boolean("coming_soon").notNull().default(false),
    // The merchant's own labels ("summer", "gift idea"), lowercase. Collections can fill by tag.
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_shop_handle_uq").on(t.shopId, t.handle),
    index("products_shop_status_idx").on(t.shopId, t.status),
    check("products_min_age_ok", sql`${t.minAge} is null or ${t.minAge} between 13 and 25`),
    check("products_reorder_days_ok", sql`${t.reorderDays} is null or ${t.reorderDays} between 7 and 180`),
  ],
);

export const variants = pgTable(
  "variants",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Default"),
    options: jsonb("options").$type<Record<string, string>>().notNull().default({}),
    sku: text("sku"),
    supplierVariantRef: text("supplier_variant_ref"),
    priceMinor: money("price_minor").notNull(),
    compareAtMinor: money("compare_at_minor"),
    costMinor: money("cost_minor"),
    stock: integer("stock"),
    // What one of these weighs packed, for shipping rates that go by weight.
    weightGrams: integer("weight_grams"),
    // How much is in one (250 g, 1.5 l, 6 items), for the price per kg, litre or item buyers compare.
    contents: jsonb("contents").$type<Contents | null>(),
    // The UPC, EAN or the store's own code a scanner reads off the item. Unique in the store.
    barcode: text("barcode"),
    // Where it sits in the store's own stock room ("A3", "Back shelf"), for the pick list and stock count.
    location: text("location"),
    // When the team was told this option of the store's own stock is running low. Cleared once it's restocked.
    lowStockNotifiedAt: timestamp("low_stock_notified_at", { withTimezone: true }),
    shipDaysMin: integer("ship_days_min"),
    shipDaysMax: integer("ship_days_max"),
    position: integer("position").notNull().default(0),
    /** One of the product's photos, shown when a buyer picks this variant (the red one, say). */
    imageUrl: text("image_url"),
  },
  (t) => [index("variants_product_idx").on(t.productId), index("variants_barcode_idx").on(t.barcode), check("variants_price_nonneg", sql`${t.priceMinor} >= 0`)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    // Set when the buyer signs in to their account on the store.
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    // Marketing email consent: given at checkout or on their account page, never assumed.
    acceptsMarketing: boolean("accepts_marketing").notNull().default(false),
    /** Emails when an item they saved gets cheaper. Asked for by the buyer, so separate from marketing. */
    priceAlerts: boolean("price_alerts").notNull().default(true),
    /** Their saved list is public at <store>/saved/<token> while this is set. Made when they press Share. */
    savedShareToken: text("saved_share_token"),
    marketingConsentAt: timestamp("marketing_consent_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    // When we last emailed a "confirm your signup" link, so a signup form can't be used to flood an inbox.
    optInSentAt: timestamp("opt_in_sent_at", { withTimezone: true }),
    // When we emailed their welcome code. Once per address, even if they sign up again later.
    welcomeCodeAt: timestamp("welcome_code_at", { withTimezone: true }),
    // When we last sent a win-back code. Another goes only after they order again and then lapse again.
    winbackSentAt: timestamp("winback_sent_at", { withTimezone: true }),
    // The product a subscriber last looked at while signed in, for one browse reminder, and when.
    lastViewedProductId: uuid("last_viewed_product_id").references((): AnyPgColumn => products.id, { onDelete: "set null" }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    // When we last sent them a browse reminder: at most one a week.
    browseRemindedAt: timestamp("browse_reminded_at", { withTimezone: true }),
    // Month and day only ("07-14"), given by the buyer on their store account. No year is asked for.
    birthday: text("birthday"),
    // The year we last sent their birthday code, so it goes once a year.
    birthdaySentYear: integer("birthday_sent_year"),
    // Their refer-a-friend link is <store>/refer/<code>. Made the first time they see it.
    referralCode: text("referral_code"),
    // Wholesale: a buyer applies from their store account and the merchant approves them.
    wholesaleStatus: text("wholesale_status", { enum: ["none", "pending", "approved", "declined"] }).notNull().default("none"),
    wholesaleCompany: text("wholesale_company"),
    wholesaleTaxId: text("wholesale_tax_id"),
    wholesaleMessage: text("wholesale_message"),
    wholesaleRequestedAt: timestamp("wholesale_requested_at", { withTimezone: true }),
    // Set by the merchant for a buyer who doesn't pay tax (a reseller, a charity): their
    // exemption certificate or resale number. Signed in, they're charged no tax.
    taxExemptId: text("tax_exempt_id"),
    // The merchant's own notes and labels ("vip", "wholesale lead"). Never shown to the buyer.
    note: text("note"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    // The tags in `tags` that a tag rule added, so the rule can take them off again when the
    // customer stops matching. A tag the merchant typed by hand is never in here.
    autoTags: jsonb("auto_tags").$type<string[]>().notNull().default([]),
    // Secret in each marketing email's unsubscribe link.
    emailToken: text("email_token").notNull().unique().default(sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customers_shop_email_uq").on(t.shopId, t.email), uniqueIndex("customers_shop_referral_code_uq").on(t.shopId, t.referralCode), uniqueIndex("customers_saved_share_uq").on(t.savedShareToken)],
);

/**
 * What the buyer saw and paid when they shopped in another currency. The order's own amounts stay
 * in the store's currency; these are for the buyer and the card charge.
 */
export type Presentment = {
  currency: string;
  /** Buyer currency units per store currency unit, fixed at checkout. */
  rate: number;
  /** Each item's unit price as shown to the buyer, by variant id. */
  units: Record<string, number>;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  /** Delivery protection; missing on orders from before it existed. */
  protectionMinor?: number;
  /** Gift wrapping; missing when there's none. */
  giftWrapMinor?: number;
  /** The buyer's tip; missing when there's none. */
  tipMinor?: number;
  taxMinor: number;
  totalMinor: number;
};

export type TaxBreakdownLine = { jurisdiction: string; label: string; rateBps: number; amountMinor: number };

export type QuantityBreak = { minQty: number; percentOff: number };
export type ProductDetail = { label: string; value: string };

/** `shipsBy` is a YYYY-MM-DD date; `limit` caps how many can be pre-ordered in all. */
export type Preorder = { shipsBy: string; limit: number | null };

/** Ad platform tags the store loads (after the buyer agrees, where the law asks for it). */
export type AdPixels = { meta: string | null; tiktok: string | null; google: string | null };

/**
 * The store closed to buyers for a while. "password": only visitors with the password get in
 * (before launch); "holiday": buyers can look around but not order. Either ends by itself on
 * `until` (YYYY-MM-DD) when set. `accessKey` is what a visitor's cookie holds once they gave the
 * password; it changes with the password.
 */
/** Which automatic badges product cards show: "-20%" on sale, "Sold out", and "New" for this many days (0 is off). */
export type BadgeSettings = { sale: boolean; soldOut: boolean; newDays: number };
export type ProductInfoBlock = { title: string; text: string };

export type ChatButtons = { whatsapp: string | null; telegram: string | null };
export type StoreClosure = { mode: "password" | "holiday"; message: string | null; until: string | null; passwordHash: string | null; accessKey: string | null };

/** How many a buyer can take: per order (`min`, `max`) and in all, across their paid orders (`perCustomer`). */
export type PurchaseLimit = { min: number | null; max: number | null; perCustomer: number | null };

export type PersonalizationField = { id: string; label: string; required: boolean; maxLength: number };
/** What the buyer typed, with the label as it was when they ordered. */
export type PersonalizationValue = { fieldId: string; label: string; value: string };

/** A gift order: who it's from, their message, and who to tell when it ships. */
/** `returnCode` is printed on the packing slip and in the recipient's email, so they can return the gift for store credit. */
export type OrderGift = { from: string; message: string | null; recipientEmail: string | null; returnCode?: string };

/** Who sent a gift back: the recipient, who gets the store credit and the emails instead of the buyer. */
export type GiftReturn = { name: string; email: string };

/** Gift cards bought for someone else: emailed to them, with a message, now or on a day the buyer picked ("2026-12-24"). */
export type GiftCardDelivery = { email: string; name: string | null; from: string; message: string | null; sendOn: string | null };

/** One change to a paid order before it shipped: a new address or another size. */
export type OrderEdit = { at: string; by: "buyer" | "merchant"; changes: string[] };

/**
 * The same product at a second supplier, used when the main one is out of stock. Variants are
 * matched to ours by option, keyed by our variant id.
 */
export type CollectionCondition =
  | { kind: "title_contains"; text: string }
  | { kind: "price_at_least"; minor: number }
  | { kind: "price_at_most"; minor: number }
  | { kind: "on_sale" }
  | { kind: "in_stock" }
  | { kind: "added_within_days"; days: number }
  | { kind: "option_is"; name: string; value: string }
  | { kind: "tagged"; tag: string };
export type CollectionRules = {
  /** "all": a product must meet every condition; "any": one is enough. */
  match: "all" | "any";
  conditions: CollectionCondition[];
  sort: "newest" | "price_asc" | "price_desc" | "title";
};

export type ProductBackup = {
  supplierId: string;
  sourceUrl: string;
  productRef: string;
  variants: Record<string, { ref: string; costMinor: number; stock: number | null }>;
  /** Set when the backup listing was taken down at the last check. */
  gone?: boolean;
  checkedAt: string;
};

/** The second checkout reminder: a percentage off, in a code that works once, for that buyer, for 48 hours. */
export type AbandonedCartOffer = { percentOff: number };
/** A share of the goods, at least a set amount: what a buyer pays to have a lost or damaged parcel sent again. */
export type DeliveryProtection = { percent: number; minMinor: number };

/** Where and how buyers pick up their orders. */
export type LocalPickup = { address: string; instructions: string | null };
/** The weekdays (0 Sunday to 6 Saturday) the store hands over pickups and local deliveries, how many days' notice it needs, and its time zone. */
export type HandoverDays = { weekdays: number[]; leadDays: number; timeZone: string };

/** Where the store delivers itself and what it charges. Postal codes match by how they start. */
/** The store's gift wrapping: its price and what buyers get ("Kraft paper and a ribbon"). */
export type GiftWrap = { priceMinor: number; note: string | null };
export type FreeGift = { variantId: string; minSubtotalMinor: number };

/** What one variant holds, in the units its price per unit is shown in. */
export type Contents = { amount: number; unit: "g" | "kg" | "ml" | "cl" | "l" | "cm" | "m" | "m2" | "item" };

/** Paying by bank transfer: the account to pay into, as the merchant writes it, and days to pay before the order lapses. */
export type BankTransfer = { details: string; days: number };

/** Same-day cutoff: the hour (1 to 23) in the store's time zone, and whether it ships at weekends. */
export type ShipCutoff = { hour: number; timeZone: string; weekends: boolean };

/** A holiday orders should arrive in time for: its name ("Christmas") and the last day they can arrive (YYYY-MM-DD). */
export type HolidayDeadline = { name: string; arriveBy: string };

/** Tips at checkout: the percentages offered, smallest first, and a thank-you line. */
export type Tipping = { percents: number[]; note: string | null };

/** The question buyers answer after paying, its choices, and whether they can type their own. */
export type BuyerSurvey = { question: string; options: string[]; other: boolean };

export type LocalDeliveryArea = { postalPrefixes: string[]; priceMinor: number; freeOverMinor: number | null; note: string | null };

export type Address = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  /** For the courier, when the store asks for it at checkout. Passed on to the supplier. */
  phone?: string;
};

export const orders = pgTable(
  "orders",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "restrict" }),
    number: integer("number").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    shippingAddress: jsonb("shipping_address").$type<Address>().notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    subtotalMinor: money("subtotal_minor").notNull(),
    shippingMinor: money("shipping_minor").notNull(),
    // Taken off the subtotal by a discount code, or by a bundle when there's no code (they don't
    // combine). A free-shipping code sets shipping to 0 instead.
    discountMinor: money("discount_minor").notNull().default(0),
    discountId: uuid("discount_id"),
    discountCode: text("discount_code"),
    /** The bundle names when the discount is bundle savings, like "Desk set". */
    bundleTitle: text("bundle_title"),
    taxMinor: money("tax_minor").notNull(),
    totalMinor: money("total_minor").notNull(),
    paymentStatus: text("payment_status", {
      enum: ["pending", "paid", "partially_refunded", "refunded", "failed"],
    })
      .notNull()
      .default("pending"),
    fulfillmentStatus: text("fulfillment_status", {
      enum: ["unfulfilled", "sent_to_supplier", "partially_shipped", "shipped", "delivered", "problem"],
    })
      .notNull()
      .default("unfulfilled"),
    paymentIntentId: text("payment_intent_id").unique(),
    // "payment_link": the merchant built the order (for a buyer who asked by message or phone)
    // and emailed a link to pay. Their note to the buyer shows in the email and on the pay page.
    // "post_purchase": added from the order page right after paying, charged to the same card.
    // "replacement": sent free by the merchant for one that was lost, damaged or wrong.
    // "subscription": a repeat delivery the buyer subscribed to, charged to their saved card.
    source: text("source", { enum: ["checkout", "payment_link", "post_purchase", "replacement", "subscription"] }).notNull().default("checkout"),
    parentOrderId: uuid("parent_order_id").references((): AnyPgColumn => orders.id, { onDelete: "set null" }),
    // For a replacement: the order it replaces.
    replacesOrderId: uuid("replaces_order_id").references((): AnyPgColumn => orders.id, { onDelete: "set null" }),
    // For a repeat delivery: the subscription that placed it.
    subscriptionId: uuid("subscription_id").references((): AnyPgColumn => subscriptions.id, { onDelete: "set null" }),
    // The buyer's card was kept with the payment provider at checkout, for an after-checkout offer.
    cardSaved: boolean("card_saved").notNull().default(false),
    // The buyer chose to pay by bank transfer instead of by card, and when; the merchant marks it paid.
    manualPayment: text("manual_payment", { enum: ["bank_transfer"] }),
    manualPaymentAt: timestamp("manual_payment_at", { withTimezone: true }),
    note: text("note"),
    // Our sales fee (free plan only) and the estimated card processing fee, fixed at checkout.
    platformFeeMinor: money("platform_fee_minor").notNull().default(0),
    processingFeeMinor: money("processing_fee_minor").notNull().default(0),
    refundedMinor: money("refunded_minor").notNull().default(0),
    // When prices include tax, tax_minor is the part of the total that is tax; otherwise it's added on top.
    taxIncluded: boolean("tax_included").notNull().default(false),
    taxBreakdown: jsonb("tax_breakdown").$type<TaxBreakdownLine[]>().notNull().default([]),
    taxCalculationId: text("tax_calculation_id"),
    presentment: jsonb("presentment").$type<Presentment>(),
    // The email campaign the buyer came from, when they clicked one in the last week.
    campaignId: uuid("campaign_id").references((): AnyPgColumn => campaigns.id, { onDelete: "set null" }),
    // Where the buyer's visit came from: a referring site ("instagram.com") or its utm_source, null when direct.
    visitSource: text("visit_source"),
    // The last blog post the buyer read in that visit before checking out, for the blog's sales.
    visitPostId: uuid("visit_post_id").references((): AnyPgColumn => blogPosts.id, { onDelete: "set null" }),
    // Placed by an approved wholesale buyer at wholesale prices.
    wholesale: boolean("wholesale").notNull().default(false),
    // Paid in part or in full with a gift card. The card is charged total minus this.
    giftCardId: uuid("gift_card_id").references((): AnyPgColumn => giftCards.id, { onDelete: "set null" }),
    giftCardMinor: money("gift_card_minor").notNull().default(0),
    // The shipping option the buyer picked, as named when they bought ("Express").
    shippingMethod: text("shipping_method"),
    // Set when the buyer marked the order as a gift. The recipient (when the buyer gave their
    // email) hears when it ships, with the message and tracking but no prices.
    gift: jsonb("gift").$type<OrderGift>(),
    // Set when the buyer sent the gift cards on the order to someone else.
    giftCardDelivery: jsonb("gift_card_delivery").$type<GiftCardDelivery>(),
    // Set when the order is paid. A held order isn't sent to the supplier until the merchant
    // sends it (heldAt cleared, riskReviewedAt set) or refunds it.
    risk: jsonb("risk").$type<OrderRisk>(),
    heldAt: timestamp("held_at", { withTimezone: true }),
    // When the items came off the store's own stock (products added by hand); cleared when they're put back.
    stockTakenAt: timestamp("stock_taken_at", { withTimezone: true }),
    // The buyer picks it up from the store instead of having it shipped. They're emailed once it's
    // ready (pickupReadyAt); it's delivered when the merchant marks it picked up.
    pickup: boolean("pickup").notNull().default(false),
    pickupReadyAt: timestamp("pickup_ready_at", { withTimezone: true }),
    // The store delivers it itself (local delivery); it's delivered when the merchant says so.
    localDelivery: boolean("local_delivery").notNull().default(false),
    // The day the buyer picked to collect it or have it delivered (store time, YYYY-MM-DD).
    handoverOn: date("handover_on", { mode: "string" }),
    riskReviewedAt: timestamp("risk_reviewed_at", { withTimezone: true }),
    // Has pre-ordered items: waits for stock before going to the supplier, promised by this date.
    preorderShipsBy: timestamp("preorder_ships_by", { withTimezone: true }),
    // When the merchant was told it's past that date and still waiting.
    preorderLateAt: timestamp("preorder_late_at", { withTimezone: true }),
    // Changes made after payment, before it shipped. The supplier order is cancelled and placed again.
    edits: jsonb("edits").$type<OrderEdit[]>().notNull().default([]),
    // What the buyer typed in "Note for the store" at checkout ("Please leave it with the neighbour").
    buyerNote: text("buyer_note"),
    // Placed by a tax-exempt buyer, so no tax was charged: their exemption number, for the records.
    taxExemptId: text("tax_exempt_id"),
    // What the buyer paid for delivery protection: if it's lost or damaged, it's sent again free.
    protectionMinor: money("protection_minor").notNull().default(0),
    // What the buyer paid to have the gift wrapped.
    giftWrapMinor: money("gift_wrap_minor").notNull().default(0),
    // The buyer's tip for the store, on top of the goods. Not taxed, and no per-sale fee on it.
    tipMinor: money("tip_minor").notNull().default(0),
    // The age the buyer confirmed at checkout for age-restricted items, so the courier or the
    // merchant knows to check ID. Null when nothing in it was restricted.
    ageConfirmed: integer("age_confirmed"),
    // The buyer's answer to the store's survey, and what they typed when they picked "Other".
    surveyAnswer: text("survey_answer"),
    surveyOther: text("survey_other"),
    // When the buyer was asked to review what they got, once per order.
    reviewRequestedAt: timestamp("review_requested_at", { withTimezone: true }),
    // When the one review reminder went, a week after the request.
    reviewRemindedAt: timestamp("review_reminded_at", { withTimezone: true }),
    // When the buyer was reminded to reorder, once per order.
    reorderRemindedAt: timestamp("reorder_reminded_at", { withTimezone: true }),
    // The merchant's own note and labels ("follow up", "vip"). Never shown to the buyer.
    staffNote: text("staff_note"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_shop_number_uq").on(t.shopId, t.number),
    // One after-checkout order per order, so a double click can't charge twice.
    uniqueIndex("orders_parent_uq").on(t.parentOrderId),
    index("orders_shop_created_idx").on(t.shopId, t.createdAt),
    check(
      "orders_total_matches",
      sql`${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor} + ${t.shippingMinor} + ${t.protectionMinor} + ${t.giftWrapMinor} + ${t.tipMinor} + case when ${t.taxIncluded} then 0 else ${t.taxMinor} end`,
    ),
    check("orders_discount_within_subtotal", sql`${t.discountMinor} >= 0 and ${t.discountMinor} <= ${t.subtotalMinor}`),
    index("orders_discount_idx").on(t.discountId),
    index("orders_replaces_idx").on(t.replacesOrderId),
    index("orders_subscription_idx").on(t.subscriptionId),
    check("orders_refund_within_total", sql`${t.refundedMinor} >= 0 and ${t.refundedMinor} <= ${t.totalMinor}`),
    check("orders_gift_card_within_total", sql`${t.giftCardMinor} >= 0 and ${t.giftCardMinor} <= ${t.totalMinor}`),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: money("unit_price_minor").notNull(),
    unitCostMinor: money("unit_cost_minor"),
    /** Added from the checkout add-on offer, at its price. */
    addonId: uuid("addon_id").references((): AnyPgColumn => checkoutAddons.id, { onDelete: "set null" }),
    personalization: jsonb("personalization").$type<PersonalizationValue[]>(),
    // Bought as a pre-order: it goes to the supplier once the option is back in stock.
    preorder: boolean("preorder").notNull().default(false),
    // Times the buyer downloaded this line's file, for a digital product.
    downloads: integer("downloads").notNull().default(0),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId), check("order_lines_qty_pos", sql`${t.quantity} > 0`)],
);

// Idempotency for incoming webhooks: providers retry, so each event id is processed once.
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

// One supplier order per supplier per customer order. The row id is sent to the supplier as the
// order reference, so a retry after a timeout can't create a second supplier order.
export const fulfillments = pgTable(
  "fulfillments",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    // Null for a parcel the merchant sent themselves.
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["pending", "placing", "placed", "shipped", "delivered", "failed", "cancelled"] })
      .notNull()
      .default("pending"),
    supplierOrderRef: text("supplier_order_ref"),
    problemCode: text("problem_code"),
    problemMessage: text("problem_message"),
    // Set when the main supplier couldn't take it and it went to a product's backup supplier.
    backupNote: text("backup_note"),
    // The main supplier a backup supplier's order stands in for, so the items aren't sent there too.
    backupForSupplierId: uuid("backup_for_supplier_id"),
    attempts: integer("attempts").notNull().default(0),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("fulfillments_order_supplier_uq").on(t.orderId, t.supplierId),
    index("fulfillments_open_idx").on(t.status).where(sql`${t.status} in ('placed', 'shipped')`),
    check("fulfillments_problem_when_failed", sql`${t.status} <> 'failed' or ${t.problemMessage} is not null`),
  ],
);

// Outgoing email log. Each (order, kind) is sent at most once.
export const emails = pgTable(
  "emails",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["order_confirmation", "shipping_update", "delivered", "refund", "support_reply", "abandoned_cart", "payment_link", "gift_shipped", "order_link", "order_updated", "abandoned_cart_offer", "pickup_ready", "bank_transfer", "bank_transfer_lapsed", "order_news", "order_late", "handover_reminder", "handover_moved"] }).notNull(),
    // Tells apart emails of a kind that can repeat (one per refund). Empty for once-only kinds.
    ref: text("ref").notNull().default(""),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    status: text("status", { enum: ["queued", "sent", "failed"] }).notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("emails_order_kind_ref_uq").on(t.orderId, t.kind, t.ref), index("emails_shop_created_idx").on(t.shopId, t.createdAt)],
);

// One theme per shop. The editor writes `draft`; publishing copies it to `published`.
// The document shape is validated in @sf/core (themes.ts), so it stays a plain jsonb here.
export const themes = pgTable("themes", {
  id: id(),
  shopId: uuid("shop_id").notNull().unique().references(() => shops.id, { onDelete: "cascade" }),
  template: text("template").notNull().default("base"),
  draft: jsonb("draft").$type<Record<string, unknown>>().notNull(),
  published: jsonb("published").$type<Record<string, unknown>>().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  /** A copy of the draft that goes live by itself at `at`, and the time to switch back, if any. */
  schedule: jsonb("schedule").$type<ThemeSchedule | null>(),
  /** The look a scheduled change replaced, put back at `at`. */
  revert: jsonb("revert").$type<ThemeRevert | null>(),
  updatedAt: updatedAt(),
});
export type ThemeSchedule = { doc: Record<string, unknown>; at: string; until: string | null };
export type ThemeRevert = { doc: Record<string, unknown>; at: string };

/** How a collection's page lists its products before the buyer picks another order. */
export const COLLECTION_SORTS = ["featured", "best_selling", "newest", "price_asc", "price_desc"] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export const collections = pgTable(
  "collections",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),
    // Set for an automatic collection: products join and leave by these rules instead of by hand.
    rules: jsonb("rules").$type<CollectionRules>(),
    // "featured" is the merchant's own order (or the rules' order for an automatic collection).
    sortOrder: text("sort_order", { enum: COLLECTION_SORTS }).notNull().default("featured"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("collections_shop_handle_uq").on(t.shopId, t.handle)],
);

export const collectionProducts = pgTable(
  "collection_products",
  {
    collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.productId] }), index("collection_products_product_idx").on(t.productId)],
);

// Plain-text pages such as About, Shipping and Returns. Shown at /pages/<handle>.
export const pages = pgTable(
  "pages",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    body: text("body").notNull().default(""),
    seoDescription: text("seo_description"),
    published: boolean("published").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pages_shop_handle_uq").on(t.shopId, t.handle)],
);

// Domains a merchant already owns, pointed at us. Only verified domains serve the store.
export const domains = pgTable(
  "domains",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    isPrimary: boolean("is_primary").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("domains_shop_idx").on(t.shopId),
    uniqueIndex("domains_one_primary_uq").on(t.shopId).where(sql`${t.isPrimary}`),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
    amountMinor: money("amount_minor").notNull(),
    platformFeeRefundedMinor: money("platform_fee_refunded_minor").notNull().default(0),
    taxRefundedMinor: money("tax_refunded_minor").notNull().default(0),
    // In the buyer's currency, when they paid in another one.
    presentmentAmountMinor: money("presentment_amount_minor"),
    // The part of the refund put back on the gift card the order was paid with.
    giftCardMinor: money("gift_card_minor").notNull().default(0),
    reason: text("reason"),
    providerRefundId: text("provider_refund_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("refunds_order_idx").on(t.orderId), check("refunds_amount_pos", sql`${t.amountMinor} > 0`)],
);

// Mirror of the payment provider's payouts, so the Money page shows status and arrival dates.
export const payouts = pgTable(
  "payouts",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    providerPayoutId: text("provider_payout_id").unique(),
    amountMinor: money("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: text("status", { enum: ["pending", "in_transit", "paid", "failed", "canceled"] }).notNull(),
    arrivalDate: date("arrival_date", { mode: "string" }),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payouts_shop_created_idx").on(t.shopId, t.createdAt)],
);

// Something the payment provider needs before it keeps paying out: an ID, a proof of address...
// Each row is one card on the Money page with the reason in plain words and what to send.
export const accountRequirements = pgTable(
  "account_requirements",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    kind: text("kind", {
      enum: ["identity_document", "proof_of_address", "bank_account", "business_details", "supplier_invoice", "tracking_info", "review"],
    }).notNull(),
    explanation: text("explanation").notNull(),
    holdsPayouts: boolean("holds_payouts").notNull().default(true),
    dueBy: timestamp("due_by", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("account_requirements_open_uq").on(t.shopId, t.providerKey).where(sql`${t.resolvedAt} is null`),
    index("account_requirements_shop_idx").on(t.shopId),
  ],
);

// Documents a merchant sends for a requirement. Kept in the database for now (5 MB cap);
// moves to object storage with the media library.
export const requirementUploads = pgTable("requirement_uploads", {
  id: id(),
  requirementId: uuid("requirement_id").notNull().references(() => accountRequirements.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  providerFileId: text("provider_file_id"),
  createdAt: createdAt(),
});

// Where a store is registered to collect tax: "GB", "EU" (OSS/IOSS), "CA" (GST/HST) or a US
// state such as "US-TX". Tax is only charged to buyers in a registered place.
export const taxRegistrations = pgTable(
  "tax_registrations",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    jurisdiction: text("jurisdiction").notNull(),
    registrationNumber: text("registration_number"),
    providerRegistrationId: text("provider_registration_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tax_registrations_shop_jurisdiction_uq").on(t.shopId, t.jurisdiction)],
);

// A message from the platform about the store's standing: a warning with a deadline, a pause,
// or a reinstatement. Every pause comes with a reason, what to fix, and a way to appeal.
export const storeNotices = pgTable(
  "store_notices",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["warning", "paused", "reinstated"] }).notNull(),
    reason: text("reason", {
      enum: ["late_shipping", "high_refunds", "chargebacks", "prohibited_product", "misleading_listing", "customer_complaints", "identity", "other"],
    }).notNull(),
    explanation: text("explanation").notNull(),
    whatToDo: text("what_to_do").notNull(),
    dueBy: timestamp("due_by", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("store_notices_shop_idx").on(t.shopId, t.createdAt)],
);

export const appeals = pgTable(
  "appeals",
  {
    id: id(),
    noticeId: uuid("notice_id").notNull().references(() => storeNotices.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    status: text("status", { enum: ["open", "accepted", "rejected"] }).notNull().default("open"),
    response: text("response"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("appeals_status_idx").on(t.status, t.createdAt),
    // One open appeal per notice at a time.
    uniqueIndex("appeals_open_uq").on(t.noticeId).where(sql`${t.status} = 'open'`),
  ],
);

// AI agents. Every run is recorded with its token use and cost, and every tool call it makes is an
// agent action: reads run straight away, changes may wait for the merchant's approval.
export const AGENTS = ["listing", "assistant", "buyer_support", "fulfilment", "margin", "writer", "translator", "answerer", "sizer"] as const;
export type AgentName = (typeof AGENTS)[number];

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    agent: text("agent", { enum: AGENTS }).notNull(),
    trigger: text("trigger", { enum: ["merchant", "buyer", "schedule", "event"] }).notNull(),
    status: text("status", { enum: ["running", "done", "failed", "over_budget"] }).notNull().default("running"),
    model: text("model").notNull(),
    conversationId: uuid("conversation_id"),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    // Millionths of a US dollar, so small runs don't round to zero.
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("agent_runs_shop_created_idx").on(t.shopId, t.createdAt), index("agent_runs_order_idx").on(t.orderId)],
);

export const agentActions = pgTable(
  "agent_actions",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    agent: text("agent", { enum: AGENTS }).notNull(),
    tool: text("tool").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    // What the merchant sees in the approvals list and the activity log.
    summary: text("summary").notNull(),
    status: text("status", { enum: ["done", "pending", "approved", "rejected", "failed", "blocked"] }).notNull(),
    // Why it needs the merchant's OK (pending), or why it was refused (blocked).
    reason: text("reason"),
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("agent_actions_shop_status_idx").on(t.shopId, t.status, t.createdAt)],
);

// A conversation: a buyer asking about an order, the merchant talking to their assistant, or a
// ticket for platform staff.
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["buyer", "assistant", "ticket"] }).notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    email: text("email"),
    subject: text("subject").notNull(),
    // needs_merchant: the agent handed it over. escalated: waiting on platform staff.
    status: text("status", { enum: ["open", "needs_merchant", "escalated", "resolved"] }).notNull().default("open"),
    statusReason: text("status_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("conversations_shop_idx").on(t.shopId, t.kind, t.updatedAt),
    index("conversations_status_idx").on(t.status, t.updatedAt),
    uniqueIndex("conversations_buyer_order_uq").on(t.orderId).where(sql`${t.kind} = 'buyer'`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    author: text("author", { enum: ["merchant", "buyer", "agent", "staff"] }).notNull(),
    body: text("body").notNull(),
    // Agent replies to buyers start as drafts unless the merchant allowed that kind of answer.
    status: text("status", { enum: ["sent", "draft", "discarded"] }).notNull().default("sent"),
    topic: text("topic"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

// Phones signed in to the app that can receive push notifications (Expo push tokens).
export const pushDevices = pgTable(
  "push_devices",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: text("platform", { enum: ["ios", "android", "web"] }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_devices_user_idx").on(t.userId)],
);

export const PUSH_KINDS = ["new_order", "problem_order", "payout_hold", "dispute", "margin_alert", "agent_proposal", "escalation_reply", "buyer_message"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

// Every push we decided to send, one row per person per event, so an event never notifies twice.
export const pushMessages = pgTable(
  "push_messages",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: PUSH_KINDS }).notNull(),
    ref: text("ref").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url").notNull(),
    // sent: handed to the push service. off: the person turned this kind off.
    status: text("status", { enum: ["pending", "sent", "failed", "off"] }).notNull(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_messages_once_uq").on(t.userId, t.kind, t.ref), index("push_messages_shop_idx").on(t.shopId, t.createdAt)],
);

// Photos merchants upload from the app. Kept in the database until object storage is set up.
export const media = pgTable(
  "media",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("media_shop_idx").on(t.shopId)],
);

// The file a digital product delivers, one per product. Kept apart from media, which is served
// to anyone with the id: these only go out through a paid order's download link.
export const digitalFiles = pgTable("digital_files", {
  id: id(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().unique().references(() => products.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  data: bytea("data").notNull(),
  createdAt: createdAt(),
});

// Discount codes buyers type at checkout.
export const discounts = pgTable(
  "discounts",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    kind: text("kind", { enum: ["percent", "amount", "free_shipping", "bxgy"] }).notNull(),
    // Percent (1 to 100) or an amount in minor units. Unused for free shipping. For buy X get Y,
    // the percent off the items given (100 is free).
    value: integer("value").notNull().default(0),
    // Buy X get Y: for every buyQty items bought, the next getQty (the cheapest) are discounted.
    buyQty: integer("buy_qty"),
    getQty: integer("get_qty"),
    // Which products count, for buy X get Y. Empty means every product.
    productIds: jsonb("product_ids").$type<string[]>().notNull().default([]),
    // Applied to every cart without typing the code (buy X get Y only).
    automatic: boolean("automatic").notNull().default(false),
    minSubtotalMinor: money("min_subtotal_minor").notNull().default(0),
    // How many paid orders may use it in total; null means no limit.
    usageLimit: integer("usage_limit"),
    oncePerCustomer: boolean("once_per_customer").notNull().default(false),
    // Only for a buyer's first order with the store ("WELCOME15 for new customers").
    firstOrderOnly: boolean("first_order_only").notNull().default(false),
    // Only buyers whose customer record has this tag (say "vip") can use the code. Checked at
    // checkout, against the email they check out with.
    customerTag: text("customer_tag"),
    // Money off (or buy X get Y) only on products in this collection, as it is at checkout, so
    // products added to it later are included. Not a foreign key: a deleted collection makes the
    // code stop working instead of turning it into a code for everything.
    collectionId: uuid("collection_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    // Welcome and referral codes are made one per person, only work for that email, and stay off
    // the codes list. Partner codes are listed on the Partners page instead, and personal codes (sent
    // to one customer from their page) on that customer's page.
    source: text("source", { enum: ["merchant", "welcome", "referral", "winback", "partner", "personal", "batch", "reminder", "birthday", "review"] }).notNull().default("merchant"),
    email: text("email"),
    // One-time codes made together (for a giveaway or a card in the parcel) belong to a batch.
    batchId: uuid("batch_id").references((): AnyPgColumn => codeBatches.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("discounts_shop_code_uq").on(t.shopId, t.code), index("discounts_batch_idx").on(t.batchId), check("discounts_value_ok", sql`${t.value} >= 0`)],
);

// A batch of one-time codes: many codes with the same offer, each usable once by anyone. The
// codes themselves are discounts rows with source "batch".
export const codeBatches = pgTable("code_batches", {
  id: id(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  count: integer("count").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

// Tag customers automatically: "spent $200 or more" → vip, "no order in 90 days" → lapsed. A rule
// keeps its tag in step with the customer: added when they match, taken off when they don't.
export const TAG_RULE_KINDS = ["spent", "orders", "bought", "lapsed"] as const;
export const customerTagRules = pgTable(
  "customer_tag_rules",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    kind: text("kind", { enum: TAG_RULE_KINDS }).notNull(),
    // spent: an amount in minor units; orders: a number of orders; lapsed: days since the last
    // order. Unused for bought.
    threshold: integer("threshold").notNull().default(0),
    // bought: the product.
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [index("customer_tag_rules_shop_idx").on(t.shopId)],
);

// Refer a friend: one row per friend who asked for their code from someone's link. Each email
// can be referred once per store. The referrer's credit is a gift card, sent once the friend's
// first order (paid with the code) is delivered.
export const referrals = pgTable(
  "referrals",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    referrerId: uuid("referrer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    friendEmail: text("friend_email").notNull(),
    discountId: uuid("discount_id").references(() => discounts.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    giftCardId: uuid("gift_card_id").references((): AnyPgColumn => giftCards.id, { onDelete: "set null" }),
    rewardMinor: money("reward_minor"),
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("referrals_shop_friend_uq").on(t.shopId, t.friendEmail), index("referrals_referrer_idx").on(t.referrerId)],
);

// Product reviews from buyers who received their order. One per order and product.
export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    // The order it was written for. Reviews brought over from another platform have none.
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rating: integer("rating").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: ["pending", "published", "hidden"] }).notNull().default("pending"),
    reply: text("reply"),
    // When the buyer was emailed the store's reply. Once per review: later edits don't email again.
    replyNotifiedAt: timestamp("reply_notified_at", { withTimezone: true }),
    // Photos the buyer added, as ids in the media table (served at /api/media/<id>).
    photoIds: jsonb("photo_ids").$type<string[]>().notNull().default([]),
    // Brought over from a review app's export: where from, and a key so the same file adds nothing twice.
    importedFrom: text("imported_from"),
    importKey: text("import_key"),
    // How many shoppers marked it helpful, kept with the review so a page can sort by it.
    helpfulCount: integer("helpful_count").notNull().default(0),
    // Shoppers who reported the review since the merchant last looked. Kept at 0 after "Keep it".
    reportCount: integer("report_count").notNull().default(0),
    // When the buyer was emailed a thank-you code for it. Shown on the review, so shoppers know.
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reviews_order_product_uq").on(t.orderId, t.productId),
    uniqueIndex("reviews_shop_import_uq").on(t.shopId, t.importKey),
    index("reviews_product_idx").on(t.productId, t.status),
    check("reviews_rating_range", sql`${t.rating} between 1 and 5`),
  ],
);

// "Helpful" votes on reviews: one per review and device, the device being a random id in a cookie.
export const reviewVotes = pgTable(
  "review_votes",
  {
    reviewId: uuid("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
    voter: text("voter").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.voter] })],
);

// Shoppers reporting a review to the merchant: one per review and device (the same cookie id as
// helpful votes). Rows stay after the merchant keeps the review, so a device can't report it twice.
export const reviewReports = pgTable(
  "review_reports",
  {
    reviewId: uuid("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
    voter: text("voter").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.voter] })],
);

// What buyers do on the store, for the funnel. No personal data: a random session id from a cookie.
export const STOREFRONT_EVENTS = ["page_view", "product_view", "add_to_cart", "checkout_start", "post_view"] as const;
export type StorefrontEventKind = (typeof STOREFRONT_EVENTS)[number];

export const storefrontEvents = pgTable(
  "storefront_events",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    kind: text("kind", { enum: STOREFRONT_EVENTS }).notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    // The blog post a post_view was for.
    postId: uuid("post_id").references((): AnyPgColumn => blogPosts.id, { onDelete: "set null" }),
    // Where the visitor came from: the referring site's host, or null when direct.
    source: text("source"),
    createdAt: createdAt(),
  },
  (t) => [index("storefront_events_shop_idx").on(t.shopId, t.createdAt), index("storefront_events_product_idx").on(t.productId), index("storefront_events_post_idx").on(t.postId)],
);

// What shoppers typed in the store's search box: one row per store, word and day, with how many
// results the last search found. No visitor is recorded, only the words.
export const searchTerms = pgTable(
  "search_terms",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    searches: integer("searches").notNull().default(1),
    results: integer("results").notNull().default(0),
  },
  (t) => [uniqueIndex("search_terms_shop_term_day_uq").on(t.shopId, t.term, t.day), index("search_terms_shop_day_idx").on(t.shopId, t.day)],
);

// Every price each option has had, written by a trigger on variants (migration 0070) whenever the
// price changes, so the store can say what the lowest price was before a discount.
export const variantPrices = pgTable(
  "variant_prices",
  {
    id: id(),
    variantId: uuid("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
    priceMinor: money("price_minor").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("variant_prices_variant_idx").on(t.variantId, t.startsAt)],
);

// Keys for the public REST API. Only a hash is stored; the key is shown once when created.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The first characters, to tell keys apart in the list.
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull().unique(),
    access: text("access", { enum: ["read", "write"] }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("api_keys_shop_idx").on(t.shopId)],
);

export const WEBHOOK_EVENTS = ["order.paid", "order.shipped", "order.delivered", "order.refunded", "product.updated"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// Addresses a store wants told about events, signed with a secret only they and we know.
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").$type<WebhookEvent[]>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_endpoints_shop_idx").on(t.shopId)],
);

// One row per endpoint per event, retried with growing gaps until it's delivered or we give up.
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event", { enum: WEBHOOK_EVENTS }).notNull(),
    ref: text("ref").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["pending", "delivered", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("webhook_deliveries_once_uq").on(t.endpointId, t.event, t.ref),
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_shop_idx").on(t.shopId, t.createdAt),
  ],
);

// Sign-in attempts, to slow down password guessing. Kept for a day.
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: id(),
    email: text("email").notNull(),
    ok: boolean("ok").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_attempts_email_idx").on(t.email, t.createdAt)],
);

// One-time links to set a new password. Only a hash of the token is kept.
export const passwordResets = pgTable(
  "password_resets",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)],
);

/**
 * What people on a store's team did: refunds, product and price changes, team and API changes and
 * other things an owner would want to look back on. The email is kept as it was, so entries still
 * read right after someone leaves the team.
 */
export const activity = pgTable(
  "activity",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    summary: text("summary").notNull(),
    href: text("href"),
    createdAt: createdAt(),
  },
  (t) => [index("activity_shop_idx").on(t.shopId, t.createdAt), index("activity_user_idx").on(t.shopId, t.userId, t.createdAt)],
);

// Saved replies: the merchant's own short answers to common buyer questions, put into the inbox's
// reply box with the buyer's name, order number and tracking filled in.
export const savedReplies = pgTable(
  "saved_replies",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("saved_replies_shop_idx").on(t.shopId, t.title)],
);

export const SAVED_VIEW_LISTS = ["products", "orders", "customers"] as const;

/** A named search and set of filters on an admin list, shared by the store's team. */
export const savedViews = pgTable(
  "saved_views",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    list: text("list", { enum: SAVED_VIEW_LISTS }).notNull(),
    name: text("name").notNull(),
    // The list's own link parameters, like "stock=sold_out&tag=summer".
    query: text("query").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("saved_views_shop_list_name_uq").on(t.shopId, t.list, t.name)],
);

/** An email or delivery address the store won't take orders from (chargebacks, stolen cards). */
export const blockedBuyers = pgTable(
  "blocked_buyers",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["email", "address"] }).notNull(),
    // Lowercased email, or "COUNTRY|POSTAL|street" for an address (addressKey in core/blocklist.ts).
    value: text("value").notNull(),
    // What the merchant sees in the list.
    label: text("label").notNull(),
    note: text("note"),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("blocked_buyers_shop_value_uq").on(t.shopId, t.kind, t.value)],
);

/** A right password for someone with two-step sign-in on, waiting for their code (10 minutes). */
export const signInChallenges = pgTable(
  "sign_in_challenges",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sign_in_challenges_user_idx").on(t.userId)],
);

// Milestone 9: inviting people to help run a store. The invite link is emailed; only its hash is kept.
export const shopInvites = pgTable(
  "shop_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "staff"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("shop_invites_shop_idx").on(t.shopId, t.email)],
);

// Buyer accounts: shoppers sign in to one store with a code emailed to them (no password).
export const buyerCodes = pgTable(
  "buyer_codes",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("buyer_codes_shop_email_idx").on(t.shopId, t.email, t.createdAt)],
);

export const buyerSessions = pgTable(
  "buyer_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("buyer_sessions_customer_idx").on(t.customerId)],
);

// Email campaigns: a merchant writes one email and sends it to buyers who said yes to marketing.
// "tagged" and "bought" narrow it to one customer tag or to buyers of one product.
export const CAMPAIGN_AUDIENCES = ["subscribers", "customers", "not_bought", "lapsed", "tagged", "bought"] as const;
export type CampaignAudience = (typeof CAMPAIGN_AUDIENCES)[number];

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    buttonLabel: text("button_label"),
    buttonPath: text("button_path"),
    audience: text("audience", { enum: CAMPAIGN_AUDIENCES }).notNull().default("subscribers"),
    audienceTag: text("audience_tag"),
    audienceProductId: uuid("audience_product_id").references(() => products.id, { onDelete: "set null" }),
    status: text("status", { enum: ["draft", "scheduled", "sending", "sent"] }).notNull().default("draft"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    recipients: integer("recipients").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaigns_shop_idx").on(t.shopId, t.createdAt)],
);

export const campaignSends = pgTable(
  "campaign_sends",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    status: text("status", { enum: ["queued", "sent", "skipped", "failed"] }).notNull().default("queued"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("campaign_sends_campaign_email_uq").on(t.campaignId, t.email), index("campaign_sends_status_idx").on(t.status, t.campaignId)],
);

// Gift cards and store credit. Only a hash of the code is kept; the buyer gets the code by email,
// and the merchant sees the last 4 characters.
export const giftCards = pgTable(
  "gift_cards",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    last4: text("last4").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    initialMinor: money("initial_minor").notNull(),
    balanceMinor: money("balance_minor").notNull(),
    email: text("email").notNull(),
    note: text("note"),
    // Sent in bulk as a gift (a company's cards for its team): who it's for and who it's from.
    recipientName: text("recipient_name"),
    fromName: text("from_name"),
    // Bought on the store (with the line it came from), or given by the merchant.
    sourceOrderId: uuid("source_order_id").references((): AnyPgColumn => orders.id, { onDelete: "set null" }),
    sourceIndex: integer("source_index"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // A card the buyer asked to arrive later: the daily job emails it (with a fresh code) from then.
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    // A bonus card given with gift cards bought: it can have its own dates to be spent between.
    bonus: boolean("bonus").notNull().default(false),
    usableFrom: timestamp("usable_from", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("gift_cards_shop_code_uq").on(t.shopId, t.codeHash),
    uniqueIndex("gift_cards_source_uq").on(t.sourceOrderId, t.sourceIndex),
    index("gift_cards_shop_idx").on(t.shopId, t.createdAt),
    check("gift_cards_balance_ok", sql`${t.balanceMinor} >= 0 and ${t.balanceMinor} <= ${t.initialMinor}`),
  ],
);

// Where a store ships and what it charges. A zone lists countries ("*" is everywhere else); each
// zone has one or more rates the buyer picks from at checkout. A store with no zones uses the
// built-in default (one rate, everywhere).
export const shippingZones = pgTable(
  "shipping_zones",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    countries: jsonb("countries").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("shipping_zones_shop_idx").on(t.shopId)],
);

export const shippingRates = pgTable(
  "shipping_rates",
  {
    id: id(),
    zoneId: uuid("zone_id").notNull().references(() => shippingZones.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceMinor: money("price_minor").notNull(),
    // Free when the goods in the cart reach this amount.
    freeOverMinor: money("free_over_minor"),
    minDays: integer("min_days"),
    maxDays: integer("max_days"),
    // Only offered when the cart weighs at least / under this much. Both empty means any weight.
    minWeightGrams: integer("min_weight_grams"),
    maxWeightGrams: integer("max_weight_grams"),
    createdAt: createdAt(),
  },
  (t) => [
    index("shipping_rates_zone_idx").on(t.zoneId),
    check("shipping_rates_price_ok", sql`${t.priceMinor} >= 0`),
    check("shipping_rates_days_ok", sql`${t.minDays} is null or ${t.maxDays} is null or ${t.minDays} <= ${t.maxDays}`),
    check("shipping_rates_weight_ok", sql`${t.minWeightGrams} is null or ${t.maxWeightGrams} is null or ${t.minWeightGrams} < ${t.maxWeightGrams}`),
  ],
);

// A buyer asking to return items from an order. The merchant approves it (with instructions),
// refunds it, gives store credit, or declines it.
export const RETURN_REASONS = ["never_arrived", "damaged", "wrong_item", "not_as_described", "too_small_or_big", "changed_mind", "other"] as const;
/** Holiday returns: orders paid from `from` to `to` (YYYY-MM-DD, inclusive) can be returned until `until`. */
export type HolidayReturns = { from: string; to: string; until: string };
/**
 * A bonus card for buying gift cards: `bonusMinor` for every `everyMinor` of gift cards on an order
 * paid from `from` to `to` (YYYY-MM-DD), spendable between `usableFrom` and `usableUntil` when set.
 */
/** The store's product finder: each answer points to a product tag, and `on` shows it on the store. */
export type ProductQuiz = { title: string; intro: string | null; on: boolean; questions: { text: string; answers: { label: string; tag: string }[] }[] };
export type GiftCardBonus = { everyMinor: number; bonusMinor: number; from: string; to: string; usableFrom: string | null; usableUntil: string | null };
/** "Running late" emails: after `days` without shipping, with the merchant's own words added when set. */
export type LateOrderNotice = { days: number; message: string | null };

export type ReturnItem = {
  lineId: string;
  title: string;
  quantity: number;
  /** Another size or colour of the same product the buyer wants instead of their money back. */
  exchangeVariantId?: string;
  exchangeTitle?: string;
};

export const returnRequests = pgTable(
  "return_requests",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["requested", "approved", "refunded", "credited", "replaced", "exchanged", "declined"] }).notNull().default("requested"),
    reason: text("reason", { enum: RETURN_REASONS }).notNull(),
    note: text("note"),
    items: jsonb("items").$type<ReturnItem[]>().notNull(),
    // What the items cost the buyer, after discounts and with tax: the default refund.
    suggestedMinor: money("suggested_minor").notNull(),
    resolvedMinor: money("resolved_minor"),
    merchantMessage: text("merchant_message"),
    refundId: uuid("refund_id").references(() => refunds.id, { onDelete: "set null" }),
    giftCardId: uuid("gift_card_id").references(() => giftCards.id, { onDelete: "set null" }),
    // The free order sent instead, when the merchant chose to replace or exchange the items.
    replacementOrderId: uuid("replacement_order_id").references((): AnyPgColumn => orders.id, { onDelete: "set null" }),
    // Set when the gift's recipient asked, with the code on the packing slip. The buyer isn't told.
    giftReturn: jsonb("gift_return").$type<GiftReturn>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("return_requests_shop_idx").on(t.shopId, t.status),
    uniqueIndex("return_requests_one_open_uq").on(t.orderId).where(sql`${t.status} in ('requested', 'approved')`),
  ],
);

// The store's blog. Like pages, the body is plain text ("## " starts a subheading, "• " a bullet),
// so nothing pasted can run in a buyer's browser. Posts can feature products from the store.
export const blogPosts = pgTable(
  "blog_posts",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    excerpt: text("excerpt"),
    body: text("body").notNull().default(""),
    imageUrl: text("image_url"),
    productIds: jsonb("product_ids").$type<string[]>().notNull().default([]),
    // Topics ("Guides", "News"), up to 5: the blog page lists them and shows one topic's posts.
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("blog_posts_shop_handle_uq").on(t.shopId, t.handle), index("blog_posts_shop_status_idx").on(t.shopId, t.status, t.publishedAt)],
);

// Back-in-stock requests: a buyer leaves their email on a sold-out option and gets one email when
// it can be bought again. Requests for things that never come back are dropped after six months.
// Cart links: one link that fills a shopper's cart with chosen products (and a code), for a DM, an ad
// or a post. Clicks are counted here; orders through it are those whose visit came from its source.
export const cartLinks = pgTable(
  "cart_links",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    token: text("token").notNull(),
    lines: jsonb("lines").$type<{ variantId: string; quantity: number }[]>().notNull(),
    discountCode: text("discount_code"),
    clicks: integer("clicks").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("cart_links_token_uq").on(t.token), index("cart_links_shop_idx").on(t.shopId)],
);

export const stockAlerts = pgTable(
  "stock_alerts",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    // Asked on a coming-soon page: the email says it's out, not that it's back.
    launch: boolean("launch").notNull().default(false),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("stock_alerts_variant_email_uq").on(t.variantId, t.email), index("stock_alerts_shop_idx").on(t.shopId, t.notifiedAt)],
);

// Every change to the store's own stock count and why: a sale, a cancellation putting it back, a
// swap to another option, or the merchant typing a new count. Imported products follow the supplier.
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    // The restock order it arrived on, for "received".
    restockOrderId: uuid("restock_order_id").references((): AnyPgColumn => restockOrders.id, { onDelete: "set null" }),
    reason: text("reason", { enum: ["start", "edit", "sale", "returned", "swap_out", "swap_in", "received", "count"] }).notNull(),
    change: integer("change").notNull(),
    // The count after it; null when the option stopped being counted.
    stockAfter: integer("stock_after"),
    // In the order they happened: changes saved together share a createdAt.
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    createdAt: createdAt(),
  },
  (t) => [index("stock_movements_variant_idx").on(t.variantId, t.seq)],
);

// Restock orders: what the merchant ordered from their own supplier for the stock they keep
// themselves, and how much of it has arrived. Receiving adds it to the stock count.
export const restockOrders = pgTable(
  "restock_orders",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    // #1, #2… per store.
    number: integer("number").notNull(),
    supplierName: text("supplier_name").notNull(),
    // Where the order is emailed, when the merchant sends it from here.
    supplierEmail: text("supplier_email"),
    // When it was last emailed to the supplier.
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    note: text("note"),
    expectedOn: date("expected_on", { mode: "string" }),
    status: text("status", { enum: ["open", "received", "cancelled"] }).notNull().default("open"),
    createdAt: createdAt(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("restock_orders_shop_number_uq").on(t.shopId, t.number), index("restock_orders_shop_status_idx").on(t.shopId, t.status)],
);

export const restockLines = pgTable(
  "restock_lines",
  {
    id: id(),
    restockOrderId: uuid("restock_order_id").notNull().references(() => restockOrders.id, { onDelete: "cascade" }),
    // Kept when the option is deleted later, with its name as it was.
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    // What one costs from this supplier; becomes the option's cost when it arrives.
    unitCostMinor: money("unit_cost_minor"),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("restock_lines_order_idx").on(t.restockOrderId),
    index("restock_lines_variant_idx").on(t.variantId),
    check("restock_lines_quantity_ok", sql`${t.quantity} > 0 and ${t.receivedQuantity} >= 0 and ${t.receivedQuantity} <= ${t.quantity}`),
  ],
);

// Old store links that should keep working: a renamed product, or a page from a store moved here.
export const redirects = pgTable(
  "redirects",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    /** A store path, lowercased, like /products/old-name. */
    fromPath: text("from_path").notNull(),
    /** A store path, or a full https address. */
    toPath: text("to_path").notNull(),
    hits: integer("hits").notNull().default(0),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("redirects_shop_from_uq").on(t.shopId, t.fromPath)],
);

// Products a signed-in buyer saved for later. Guests keep theirs in a cookie until they sign in.
export const savedItems = pgTable(
  "saved_items",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    /** The lowest price when they saved it, shown as "was" on their Saved page. */
    priceMinor: integer("price_minor").notNull(),
    /** The price the next price-drop email is measured against: the saved price, then each price we told them about. */
    alertPriceMinor: integer("alert_price_minor").notNull(),
    lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("saved_items_customer_product_uq").on(t.customerId, t.productId), index("saved_items_shop_product_idx").on(t.shopId, t.productId)],
);

// A store's own words in another language: a product's title and description, a collection, a
// page, or the theme's text (menus, home page sections). Written by the AI translator or the
// merchant. source_hash is the original text when it was translated, so the admin can say which
// translations are out of date after the original changes.
export const TRANSLATABLE = ["product", "collection", "page", "theme"] as const;
export type TranslatableKind = (typeof TRANSLATABLE)[number];

export const translations = pgTable(
  "translations",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    kind: text("kind", { enum: TRANSLATABLE }).notNull(),
    /** The product, collection or page id; the shop id for the theme. */
    refId: uuid("ref_id").notNull(),
    /** product and collection: title, description. page: title, body. theme: original text -> translated text. */
    fields: jsonb("fields").$type<Record<string, string>>().notNull(),
    sourceHash: text("source_hash").notNull(),
    byAi: boolean("by_ai").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("translations_ref_uq").on(t.shopId, t.language, t.kind, t.refId)],
);

// Products sold together for less: buying one of each takes percent_off off those items.
export const bundles = pgTable(
  "bundles",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Two to four products, in the order they're shown. */
    productIds: jsonb("product_ids").$type<string[]>().notNull(),
    percentOff: integer("percent_off").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bundles_shop_idx").on(t.shopId)],
);

// Every change to a buyer's points: earned on an order, taken back on a refund, swapped for store
// credit, or changed by the merchant. The balance is the sum.
export const rewardEntries = pgTable(
  "reward_entries",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    points: integer("points").notNull(),
    kind: text("kind", { enum: ["order", "refund", "redeem", "adjust"] }).notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    /** The refund (kind refund) or store credit (kind redeem) it came from. */
    refId: uuid("ref_id"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("reward_entries_customer_idx").on(t.customerId, t.createdAt),
    uniqueIndex("reward_entries_order_uq").on(t.orderId, t.kind, t.refId),
  ],
);

export type InvoiceSeller = { name: string; address: string | null; taxNumbers: { label: string; number: string }[]; footer: string | null };

// A numbered invoice for a paid order, or a credit note for one of its refunds. The seller's
// details are copied in when it's issued, so changing them later never rewrites an old invoice.
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["invoice", "credit_note"] }).notNull(),
    /** Set on credit notes. */
    refundId: uuid("refund_id").references(() => refunds.id, { onDelete: "cascade" }),
    /** Like "INV-0042": the prefix when it was issued plus the number in the series. */
    number: text("number").notNull(),
    seq: integer("seq").notNull(),
    seller: jsonb("seller").$type<InvoiceSeller>().notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invoices_shop_seq_uq").on(t.shopId, t.seq),
    uniqueIndex("invoices_order_invoice_uq").on(t.orderId).where(sql`${t.kind} = 'invoice'`),
    uniqueIndex("invoices_refund_uq").on(t.refundId),
    index("invoices_shop_issued_idx").on(t.shopId, t.issuedAt),
    check("invoices_refund_when_credit", sql`(${t.kind} = 'credit_note') = (${t.refundId} is not null)`),
  ],
);

// A sale: a percentage off everything, one collection, or chosen products, between two times.
// Prices show the old price crossed out while it runs; it ends by itself. Overlapping sales
// don't add up: a product gets the biggest one.
export const sales = pgTable(
  "sales",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    percentOff: integer("percent_off").notNull(),
    scope: text("scope", { enum: ["all", "collection", "products"] }).notNull().default("all"),
    collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "cascade" }),
    productIds: jsonb("product_ids").$type<string[]>().notNull().default([]),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** Null: runs until the merchant ends it. */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    // Count down to the end on the store: on the product pages it covers, and in a banner when it covers everything.
    countdown: boolean("countdown").notNull().default(false),
    // A code that gets subscribers (or tagged customers) the sale price before it starts. It stops when the sale starts.
    earlyDiscountId: uuid("early_discount_id").references(() => discounts.id, { onDelete: "set null" }),
    // One of a run of one-product, one-day deals: the store's /deal link goes to whichever is on.
    dailyDeal: boolean("daily_deal").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sales_shop_idx").on(t.shopId, t.startsAt),
    check("sales_percent", sql`${t.percentOff} between 1 and 90`),
    check("sales_ends_after_start", sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    check("sales_collection_scope", sql`(${t.scope} = 'collection') = (${t.collectionId} is not null)`),
  ],
);

// A product offered at checkout for a little less ("Add a stand for $8.99, save 30%"). Buyers add
// it with one tap; the price holds when it's bought with something else.
export const checkoutAddons = pgTable(
  "checkout_addons",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    percentOff: integer("percent_off").notNull().default(0),
    /** One line under the product, like "Keeps your phone charged on the go". */
    pitch: text("pitch"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("checkout_addons_shop_product_uq").on(t.shopId, t.productId),
    check("checkout_addons_percent", sql`${t.percentOff} between 0 and 50`),
  ],
);

// Questions buyers ask on a product page ("Does it come with a plug for the UK?"). The merchant
// answers in the admin, where the AI can draft the answer; answered questions show on the page
// and the buyer gets the answer by email.
export const productQuestions = pgTable(
  "product_questions",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    body: text("body").notNull(),
    /** waiting: not answered yet. published: answered and on the page. private: answered by email only. */
    status: text("status", { enum: ["waiting", "published", "private"] }).notNull().default("waiting"),
    answer: text("answer"),
    /** The AI's suggested answer, until the merchant uses or changes it. */
    draft: text("draft"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    /** When the buyer was emailed the answer. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("product_questions_shop_idx").on(t.shopId, t.status, t.createdAt),
    index("product_questions_product_idx").on(t.productId, t.status),
    check("product_questions_answered", sql`${t.status} = 'waiting' or ${t.answer} is not null`),
  ],
);

// Size charts: a table of measurements per size ("M: chest 96-101 cm"), made once and shown on the
// product pages it's attached to, directly or through a collection. Charts the AI drafts start
// hidden until the merchant checks them.
export const sizeCharts = pgTable(
  "size_charts",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    unit: text("unit", { enum: ["cm", "in"] }).notNull().default("cm"),
    /** Column headings; the first column is the size name. */
    columns: jsonb("columns").$type<string[]>().notNull(),
    rows: jsonb("rows").$type<string[][]>().notNull(),
    /** How to measure, or anything else shown under the table. */
    note: text("note"),
    productIds: jsonb("product_ids").$type<string[]>().notNull().default([]),
    collectionIds: jsonb("collection_ids").$type<string[]>().notNull().default([]),
    published: boolean("published").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("size_charts_shop_idx").on(t.shopId)],
);

// Bulk edits from the Products list, kept with what they replaced so each can be undone for a week.
export const bulkEdits = pgTable(
  "bulk_edits",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    action: jsonb("action").$type<BulkEditAction>().notNull(),
    snapshot: jsonb("snapshot").$type<BulkEditSnapshot>().notNull(),
    products: integer("products").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [index("bulk_edits_shop_idx").on(t.shopId, t.createdAt)],
);

export const AD_CHANNELS = ["meta", "google", "tiktok", "pinterest", "snapchat", "other"] as const;

// Ad spend the merchant enters (or a later ads connection fills in), per day and channel, and
// optionally per product, so the profit report can show profit after ads.
export const adSpend = pgTable(
  "ad_spend",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    /** The day the money was spent, YYYY-MM-DD in UTC. */
    day: text("day").notNull(),
    channel: text("channel", { enum: AD_CHANNELS }).notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    amountMinor: money("amount_minor").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ad_spend_shop_day_idx").on(t.shopId, t.day), check("ad_spend_amount_pos", sql`${t.amountMinor} > 0`)],
);

/**
 * Subscribe and save: the items of a paid order, sent again every few weeks at a discount and
 * charged to the card kept from that order. The buyer manages it from a private link (the token).
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    token: text("token").notNull().unique(),
    // The order the buyer subscribed from; its saved card is charged for each delivery.
    firstOrderId: uuid("first_order_id").notNull().references((): AnyPgColumn => orders.id, { onDelete: "cascade" }),
    lines: jsonb("lines").$type<{ variantId: string; quantity: number; custom?: Record<string, string> }[]>().notNull(),
    shippingAddress: jsonb("shipping_address").$type<Address>().notNull(),
    intervalDays: integer("interval_days").notNull(),
    percentOff: integer("percent_off").notNull(),
    status: text("status", { enum: ["active", "paused", "cancelled"] }).notNull().default("active"),
    // Who paused it: the buyer, or us after the card failed three times in a row.
    pausedBy: text("paused_by", { enum: ["buyer", "payment"] }),
    nextOrderAt: timestamp("next_order_at", { withTimezone: true }).notNull(),
    // The delivery date the "coming up" email was sent for, so it goes once per delivery.
    remindedFor: timestamp("reminded_for", { withTimezone: true }),
    failures: integer("failures").notNull().default(0),
    lastError: text("last_error"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("subscriptions_first_order_uq").on(t.firstOrderId),
    index("subscriptions_shop_idx").on(t.shopId, t.createdAt),
    index("subscriptions_due_idx").on(t.status, t.nextOrderAt),
    check("subscriptions_interval", sql`${t.intervalDays} between 7 and 120`),
    check("subscriptions_percent", sql`${t.percentOff} between 0 and 50`),
  ],
);

/**
 * A buyer asked their bank to take a payment back (a chargeback), or asked a question first (an
 * inquiry). The merchant answers with evidence before the due date, mostly gathered for them.
 */
export const disputes = pgTable(
  "disputes",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references((): AnyPgColumn => orders.id, { onDelete: "set null" }),
    providerDisputeId: text("provider_dispute_id").notNull().unique(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull(),
    // The card network's reason: fraudulent, product_not_received, product_unacceptable, ...
    reason: text("reason").notNull(),
    status: text("status", { enum: ["needs_response", "under_review", "won", "lost", "closed"] }).notNull(),
    // An inquiry: the bank asked, but hasn't taken the money back yet.
    inquiry: boolean("inquiry").notNull().default(false),
    evidenceDueBy: timestamp("evidence_due_by", { withTimezone: true }),
    // What the merchant added to the evidence we put together, and when it went.
    note: text("note"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    // When the merchant was emailed about it.
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("disputes_shop_idx").on(t.shopId, t.createdAt), index("disputes_order_idx").on(t.orderId)],
);

/**
 * A supplier raised the cost of an option. Open until the merchant raises the price or keeps it;
 * "repriced" when the store raised it on its own with the pricing rule.
 */
export const costChanges = pgTable(
  "cost_changes",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => variants.id, { onDelete: "cascade" }),
    costBeforeMinor: money("cost_before_minor").notNull(),
    costAfterMinor: money("cost_after_minor").notNull(),
    // The option's price when the cost went up, and after the store raised it.
    priceMinor: money("price_minor").notNull(),
    newPriceMinor: money("new_price_minor"),
    status: text("status", { enum: ["open", "repriced", "raised", "kept"] }).notNull().default("open"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("cost_changes_shop_idx").on(t.shopId, t.status, t.createdAt), index("cost_changes_variant_idx").on(t.variantId, t.status)],
);

/**
 * Partners: people who promote the store (a creator, a blogger, a friend with a following) with
 * their own discount code. Orders paid with the code earn them a share of the goods, and the
 * merchant records what they've paid them. Each partner sees their own numbers through a private
 * link (portal_token), with no buyer details.
 */
export const partners = pgTable(
  "partners",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    discountId: uuid("discount_id").notNull().references(() => discounts.id, { onDelete: "restrict" }),
    // Their share of goods paid for with the code, after the discount and less refunds, in basis points (1000 = 10%).
    commissionBps: integer("commission_bps").notNull(),
    portalToken: text("portal_token")
      .notNull()
      .unique()
      .default(sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("partners_discount_uq").on(t.discountId),
    index("partners_shop_idx").on(t.shopId),
    check("partners_commission_ok", sql`${t.commissionBps} >= 0 and ${t.commissionBps} <= 5000`),
  ],
);

// What the merchant paid a partner, recorded by hand (the money moves outside the store).
export const partnerPayouts = pgTable(
  "partner_payouts",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
    amountMinor: money("amount_minor").notNull(),
    note: text("note"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("partner_payouts_partner_idx").on(t.partnerId), check("partner_payouts_amount_ok", sql`${t.amountMinor} > 0`)],
);
