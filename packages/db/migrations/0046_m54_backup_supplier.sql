ALTER TABLE "fulfillments" ADD COLUMN "backup_note" text;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD COLUMN "backup_for_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "backup" jsonb;