CREATE TABLE "shipping_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"free_over_minor" bigint,
	"min_days" integer,
	"max_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_rates_price_ok" CHECK ("shipping_rates"."price_minor" >= 0),
	CONSTRAINT "shipping_rates_days_ok" CHECK ("shipping_rates"."min_days" is null or "shipping_rates"."max_days" is null or "shipping_rates"."min_days" <= "shipping_rates"."max_days")
);
--> statement-breakpoint
CREATE TABLE "shipping_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_method" text;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipping_rates_zone_idx" ON "shipping_rates" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "shipping_zones_shop_idx" ON "shipping_zones" USING btree ("shop_id");