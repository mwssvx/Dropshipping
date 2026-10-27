ALTER TABLE "orders" ADD COLUMN "manual_payment" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "manual_payment_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "bank_transfer" jsonb;