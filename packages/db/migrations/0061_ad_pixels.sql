ALTER TABLE "shops" ADD COLUMN "ad_pixels" jsonb;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "cookie_consent" text DEFAULT 'everyone' NOT NULL;