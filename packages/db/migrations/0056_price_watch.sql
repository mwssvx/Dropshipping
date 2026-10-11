CREATE TABLE "cost_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"cost_before_minor" bigint NOT NULL,
	"cost_after_minor" bigint NOT NULL,
	"price_minor" bigint NOT NULL,
	"new_price_minor" bigint,
	"status" text DEFAULT 'open' NOT NULL,
	"notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "min_margin_percent" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "auto_reprice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_changes" ADD CONSTRAINT "cost_changes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_changes" ADD CONSTRAINT "cost_changes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_changes" ADD CONSTRAINT "cost_changes_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_changes_shop_idx" ON "cost_changes" USING btree ("shop_id","status","created_at");--> statement-breakpoint
CREATE INDEX "cost_changes_variant_idx" ON "cost_changes" USING btree ("variant_id","status");