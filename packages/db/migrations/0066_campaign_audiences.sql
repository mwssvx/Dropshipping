ALTER TABLE "campaigns" ADD COLUMN "audience_tag" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "audience_product_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_audience_product_id_products_id_fk" FOREIGN KEY ("audience_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;