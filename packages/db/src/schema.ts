// Milestone 1 to 4 tables. Full target schema from the plan: ../schema-target.sql.
// Money is integer minor units plus a currency. Times are timestamptz.
import { sql } from "drizzle-orm";
import {
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
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shops_handle_format", sql`${t.handle} ~ '^[a-z0-9](-?[a-z0-9])*$'`),
    check("shops_reason_when_not_active", sql`${t.status} = 'active' or ${t.statusReason} is not null`),
  ],
);

export const shopMembers = pgTable(
  "shop_members",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "staff"] }).notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.userId] }), index("shop_members_user_idx").on(t.userId)],
);

// A supplier connection for one store. Credentials live in a secret store; only a pointer is kept here.
export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["fake", "cj"] }).notNull(),
    credentialsRef: text("credentials_ref"),
    status: text("status", { enum: ["connected", "error", "disconnected"] }).notNull().default("connected"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppliers_shop_provider_uq").on(t.shopId, t.provider)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    descriptionHtml: text("description_html").notNull().default(""),
    imageUrl: text("image_url"),
    status: text("status", { enum: ["draft", "active", "archived"] }).notNull().default("draft"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    supplierProductRef: text("supplier_product_ref"),
    sourceUrl: text("source_url"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_shop_handle_uq").on(t.shopId, t.handle),
    index("products_shop_status_idx").on(t.shopId, t.status),
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
    shipDaysMin: integer("ship_days_min"),
    shipDaysMax: integer("ship_days_max"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("variants_product_idx").on(t.productId), check("variants_price_nonneg", sql`${t.priceMinor} >= 0`)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customers_shop_email_uq").on(t.shopId, t.email)],
);

export type Address = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
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
    // Our sales fee (free plan only) and the estimated card processing fee, fixed at checkout.
    platformFeeMinor: money("platform_fee_minor").notNull().default(0),
    processingFeeMinor: money("processing_fee_minor").notNull().default(0),
    refundedMinor: money("refunded_minor").notNull().default(0),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_shop_number_uq").on(t.shopId, t.number),
    index("orders_shop_created_idx").on(t.shopId, t.createdAt),
    check("orders_total_matches", sql`${t.totalMinor} = ${t.subtotalMinor} + ${t.shippingMinor} + ${t.taxMinor}`),
    check("orders_refund_within_total", sql`${t.refundedMinor} >= 0 and ${t.refundedMinor} <= ${t.totalMinor}`),
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
    kind: text("kind", { enum: ["order_confirmation", "shipping_update", "delivered", "refund"] }).notNull(),
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
  updatedAt: updatedAt(),
});

export const collections = pgTable(
  "collections",
  {
    id: id(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),
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
