CREATE TABLE "customer_tag_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"kind" text NOT NULL,
	"threshold" integer DEFAULT 0 NOT NULL,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "auto_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_tag_rules" ADD CONSTRAINT "customer_tag_rules_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tag_rules" ADD CONSTRAINT "customer_tag_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_tag_rules_shop_idx" ON "customer_tag_rules" USING btree ("shop_id");