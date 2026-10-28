ALTER TABLE "customers" ADD COLUMN "saved_share_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_saved_share_uq" ON "customers" USING btree ("saved_share_token");