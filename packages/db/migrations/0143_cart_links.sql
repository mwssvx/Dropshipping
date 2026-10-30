CREATE TABLE "cart_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"lines" jsonb NOT NULL,
	"discount_code" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_links" ADD CONSTRAINT "cart_links_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_links_token_uq" ON "cart_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "cart_links_shop_idx" ON "cart_links" USING btree ("shop_id");