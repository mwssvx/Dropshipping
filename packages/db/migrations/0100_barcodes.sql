ALTER TABLE "variants" ADD COLUMN "barcode" text;--> statement-breakpoint
CREATE INDEX "variants_barcode_idx" ON "variants" USING btree ("barcode");