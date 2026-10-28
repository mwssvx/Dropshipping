ALTER TABLE "ai_reports" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "ai_watch_email" boolean DEFAULT true NOT NULL;