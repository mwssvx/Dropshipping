ALTER TABLE "orders" ADD COLUMN "pickup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "local_pickup" jsonb;