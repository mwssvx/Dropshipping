ALTER TABLE "orders" ADD COLUMN "buyer_note" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "staff_note" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;