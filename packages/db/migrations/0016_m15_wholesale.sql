ALTER TABLE "customers" ADD COLUMN "wholesale_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "wholesale_company" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "wholesale_tax_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "wholesale_message" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "wholesale_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "wholesale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "quantity_breaks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "wholesale_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "wholesale_percent_off" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "wholesale_min_order_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_wholesale_percent" CHECK ("shops"."wholesale_percent_off" between 1 and 80);