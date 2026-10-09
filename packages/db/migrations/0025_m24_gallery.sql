ALTER TABLE "products" ADD COLUMN "images" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Existing products keep their one photo as the start of the gallery.
UPDATE "products" SET "images" = jsonb_build_array("image_url") WHERE "image_url" IS NOT NULL;
