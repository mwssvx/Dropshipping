CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"response" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"explanation" text NOT NULL,
	"what_to_do" text NOT NULL,
	"due_by" timestamp with time zone,
	"created_by" text NOT NULL,
	"read_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"jurisdiction" text NOT NULL,
	"registration_number" text,
	"provider_registration_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_total_matches";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_included" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_calculation_id" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "tax_refunded_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "prices_include_tax" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_notice_id_store_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."store_notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_notices" ADD CONSTRAINT "store_notices_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appeals_status_idx" ON "appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appeals_open_uq" ON "appeals" USING btree ("notice_id") WHERE "appeals"."status" = 'open';--> statement-breakpoint
CREATE INDEX "store_notices_shop_idx" ON "store_notices" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_registrations_shop_jurisdiction_uq" ON "tax_registrations" USING btree ("shop_id","jurisdiction");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_matches" CHECK ("orders"."total_minor" = "orders"."subtotal_minor" + "orders"."shipping_minor" + case when "orders"."tax_included" then 0 else "orders"."tax_minor" end);--> statement-breakpoint
UPDATE "shops" SET "prices_include_tax" = true WHERE "country" NOT IN ('US', 'CA');