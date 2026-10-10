CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"percent_off" integer NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"collection_id" uuid,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_percent" CHECK ("sales"."percent_off" between 1 and 90),
	CONSTRAINT "sales_ends_after_start" CHECK ("sales"."ends_at" is null or "sales"."ends_at" > "sales"."starts_at"),
	CONSTRAINT "sales_collection_scope" CHECK (("sales"."scope" = 'collection') = ("sales"."collection_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_shop_idx" ON "sales" USING btree ("shop_id","starts_at");