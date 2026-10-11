CREATE TABLE "variant_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"price_minor" bigint NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "lowest_price_note" text DEFAULT 'eu' NOT NULL;--> statement-breakpoint
ALTER TABLE "variant_prices" ADD CONSTRAINT "variant_prices_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "variant_prices_variant_idx" ON "variant_prices" USING btree ("variant_id","starts_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_variant_price() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.price_minor IS DISTINCT FROM OLD.price_minor THEN
    INSERT INTO variant_prices (variant_id, price_minor) VALUES (NEW.id, NEW.price_minor);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER variants_price_history AFTER INSERT OR UPDATE OF price_minor ON variants FOR EACH ROW EXECUTE FUNCTION record_variant_price();--> statement-breakpoint
INSERT INTO variant_prices (variant_id, price_minor) SELECT id, price_minor FROM variants;
