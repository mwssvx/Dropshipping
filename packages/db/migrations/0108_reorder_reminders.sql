ALTER TABLE "orders" ADD COLUMN "reorder_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reorder_days" integer;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_reorder_days_ok" CHECK ("products"."reorder_days" is null or "products"."reorder_days" between 7 and 180);