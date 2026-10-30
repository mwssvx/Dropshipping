ALTER TABLE "gift_cards" ADD COLUMN "bonus" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD COLUMN "usable_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "gift_card_bonus" jsonb;