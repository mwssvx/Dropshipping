ALTER TABLE "orders" ADD COLUMN "local_delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "local_delivery_area" jsonb;