ALTER TABLE "orders" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "review_request_days" integer DEFAULT 7 NOT NULL;