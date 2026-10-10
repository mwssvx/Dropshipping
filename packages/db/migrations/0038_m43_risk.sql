ALTER TABLE "orders" ADD COLUMN "risk" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "risk_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "hold_risky_orders" text DEFAULT 'high' NOT NULL;