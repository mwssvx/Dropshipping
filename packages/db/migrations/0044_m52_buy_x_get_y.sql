ALTER TABLE "discounts" ADD COLUMN "buy_qty" integer;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "get_qty" integer;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "automatic" boolean DEFAULT false NOT NULL;