ALTER TABLE "customers" ADD COLUMN "last_viewed_product_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "last_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "browse_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "browse_reminders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_last_viewed_product_id_products_id_fk" FOREIGN KEY ("last_viewed_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;