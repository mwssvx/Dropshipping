CREATE TABLE "search_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"term" text NOT NULL,
	"day" date NOT NULL,
	"searches" integer DEFAULT 1 NOT NULL,
	"results" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "search_terms_shop_term_day_uq" ON "search_terms" USING btree ("shop_id","term","day");--> statement-breakpoint
CREATE INDEX "search_terms_shop_day_idx" ON "search_terms" USING btree ("shop_id","day");