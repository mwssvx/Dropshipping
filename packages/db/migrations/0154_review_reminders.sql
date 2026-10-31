ALTER TABLE "orders" ADD COLUMN "review_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "review_reminder" boolean DEFAULT false NOT NULL;