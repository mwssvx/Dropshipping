ALTER TABLE "shops" ADD COLUMN "restock_alert_at" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "low_stock_notified_at" timestamp with time zone;