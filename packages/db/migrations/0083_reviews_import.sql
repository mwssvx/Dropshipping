ALTER TABLE "reviews" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "imported_from" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "import_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_shop_import_uq" ON "reviews" USING btree ("shop_id","import_key");