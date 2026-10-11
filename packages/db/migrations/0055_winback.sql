ALTER TABLE "customers" ADD COLUMN "winback_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "winback_offer" jsonb;