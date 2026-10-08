CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid,
	"kind" text NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"supplier_order_ref" text,
	"problem_code" text,
	"problem_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"tracking_url" text,
	"placed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillments_problem_when_failed" CHECK ("fulfillments"."status" <> 'failed' or "fulfillments"."problem_message" is not null)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"credentials_ref" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "supplier_variant_ref" text;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "emails_order_kind_uq" ON "emails" USING btree ("order_id","kind");--> statement-breakpoint
CREATE INDEX "emails_shop_created_idx" ON "emails" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillments_order_supplier_uq" ON "fulfillments" USING btree ("order_id","supplier_id");--> statement-breakpoint
CREATE INDEX "fulfillments_open_idx" ON "fulfillments" USING btree ("status") WHERE "fulfillments"."status" in ('placed', 'shipped');--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_shop_provider_uq" ON "suppliers" USING btree ("shop_id","provider");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;