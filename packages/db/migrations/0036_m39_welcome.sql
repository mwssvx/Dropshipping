ALTER TABLE "customers" ADD COLUMN "welcome_code_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "source" text DEFAULT 'merchant' NOT NULL;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "welcome_offer" jsonb;