ALTER TABLE "sessions" ADD COLUMN "device" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "known_devices" jsonb DEFAULT '[]'::jsonb NOT NULL;