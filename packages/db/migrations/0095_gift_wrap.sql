ALTER TABLE "orders" DROP CONSTRAINT "orders_total_matches";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_wrap_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "gift_wrap" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_matches" CHECK ("orders"."total_minor" = "orders"."subtotal_minor" - "orders"."discount_minor" + "orders"."shipping_minor" + "orders"."protection_minor" + "orders"."gift_wrap_minor" + case when "orders"."tax_included" then 0 else "orders"."tax_minor" end);