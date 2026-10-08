// Milestone 1 and 2 tables. Full target schema from the plan: ../schema-target.sql.
// Money is integer minor units plus a currency. Times are timestamptz.
import { sql } from "drizzle-orm";
import {
  bigint,
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
    plan: text("plan", { enum: ["starter", "growth", "scale"] }).notNull().default("starter"),
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
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_shop_number_uq").on(t.shopId, t.number),
    index("orders_shop_created_idx").on(t.shopId, t.createdAt),
    check("orders_total_matches", sql`${t.totalMinor} = ${t.subtotalMinor} + ${t.shippingMinor} + ${t.taxMinor}`),
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
    kind: text("kind", { enum: ["order_confirmation", "shipping_update", "delivered"] }).notNull(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    status: text("status", { enum: ["queued", "sent", "failed"] }).notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("emails_order_kind_uq").on(t.orderId, t.kind), index("emails_shop_created_idx").on(t.shopId, t.createdAt)],
);
