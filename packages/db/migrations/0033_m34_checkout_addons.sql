CREATE TABLE "checkout_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"percent_off" integer DEFAULT 0 NOT NULL,
	"pitch" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_addons_percent" CHECK ("checkout_addons"."percent_off" between 0 and 50)
);
--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "addon_id" uuid;--> statement-breakpoint
ALTER TABLE "checkout_addons" ADD CONSTRAINT "checkout_addons_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_addons" ADD CONSTRAINT "checkout_addons_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_addons_shop_product_uq" ON "checkout_addons" USING btree ("shop_id","product_id");--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_addon_id_checkout_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."checkout_addons"("id") ON DELETE set null ON UPDATE no action;