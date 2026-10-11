ALTER TABLE "order_lines" ADD COLUMN "preorder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "preorder_ships_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "preorder_late_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "preorder" jsonb;