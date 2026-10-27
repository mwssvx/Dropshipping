ALTER TABLE "orders" ADD COLUMN "age_confirmed" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "min_age" integer;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_min_age_ok" CHECK ("products"."min_age" is null or "products"."min_age" between 13 and 25);