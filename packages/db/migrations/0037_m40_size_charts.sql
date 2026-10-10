CREATE TABLE "size_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'cm' NOT NULL,
	"columns" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"note" text,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collection_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "size_charts" ADD CONSTRAINT "size_charts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "size_charts_shop_idx" ON "size_charts" USING btree ("shop_id");