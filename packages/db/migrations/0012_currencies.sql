ALTER TABLE "orders" ADD COLUMN "presentment" jsonb;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "presentment_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "presentment_currencies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "round_converted_prices" boolean DEFAULT true NOT NULL;