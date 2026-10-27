ALTER TABLE "shipping_rates" ADD COLUMN "min_weight_grams" integer;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN "max_weight_grams" integer;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_weight_ok" CHECK ("shipping_rates"."min_weight_grams" is null or "shipping_rates"."max_weight_grams" is null or "shipping_rates"."min_weight_grams" < "shipping_rates"."max_weight_grams");