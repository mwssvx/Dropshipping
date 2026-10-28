ALTER TABLE "gift_cards" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_delivery" jsonb;