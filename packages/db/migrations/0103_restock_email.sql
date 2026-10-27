ALTER TABLE "restock_orders" ADD COLUMN "supplier_email" text;--> statement-breakpoint
ALTER TABLE "restock_orders" ADD COLUMN "emailed_at" timestamp with time zone;