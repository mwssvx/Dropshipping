ALTER TABLE "order_lines" ADD COLUMN "personalization" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "personalization" jsonb DEFAULT '[]'::jsonb NOT NULL;