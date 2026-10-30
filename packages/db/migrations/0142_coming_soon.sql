ALTER TABLE "products" ADD COLUMN "coming_soon" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD COLUMN "launch" boolean DEFAULT false NOT NULL;