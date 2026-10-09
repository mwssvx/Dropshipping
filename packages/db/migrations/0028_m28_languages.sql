CREATE TABLE "translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"language" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"by_ai" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "languages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "translations_ref_uq" ON "translations" USING btree ("shop_id","language","kind","ref_id");