ALTER TABLE "orders" ADD COLUMN "parent_order_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "card_saved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "post_purchase_offer" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_parent_order_id_orders_id_fk" FOREIGN KEY ("parent_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_parent_uq" ON "orders" USING btree ("parent_order_id");