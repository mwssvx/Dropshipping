ALTER TABLE "products" ADD COLUMN "badge" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "product_badges" jsonb DEFAULT '{"sale":true,"soldOut":true,"newDays":0}'::jsonb NOT NULL;