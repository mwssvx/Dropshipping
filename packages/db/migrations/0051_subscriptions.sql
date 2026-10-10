CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_id" uuid,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"first_order_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"interval_days" integer NOT NULL,
	"percent_off" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_by" text,
	"next_order_at" timestamp with time zone NOT NULL,
	"reminded_for" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_token_unique" UNIQUE("token"),
	CONSTRAINT "subscriptions_interval" CHECK ("subscriptions"."interval_days" between 7 and 120),
	CONSTRAINT "subscriptions_percent" CHECK ("subscriptions"."percent_off" between 0 and 50)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "subscription_offer" jsonb;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_first_order_id_orders_id_fk" FOREIGN KEY ("first_order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_first_order_uq" ON "subscriptions" USING btree ("first_order_id");--> statement-breakpoint
CREATE INDEX "subscriptions_shop_idx" ON "subscriptions" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "subscriptions_due_idx" ON "subscriptions" USING btree ("status","next_order_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_subscription_idx" ON "orders" USING btree ("subscription_id");