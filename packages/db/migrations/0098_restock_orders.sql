CREATE TABLE "restock_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restock_order_id" uuid NOT NULL,
	"variant_id" uuid,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost_minor" bigint,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "restock_lines_quantity_ok" CHECK ("restock_lines"."quantity" > 0 and "restock_lines"."received_quantity" >= 0 and "restock_lines"."received_quantity" <= "restock_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "restock_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"supplier_name" text NOT NULL,
	"note" text,
	"expected_on" date,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "restock_order_id" uuid;--> statement-breakpoint
ALTER TABLE "restock_lines" ADD CONSTRAINT "restock_lines_restock_order_id_restock_orders_id_fk" FOREIGN KEY ("restock_order_id") REFERENCES "public"."restock_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_lines" ADD CONSTRAINT "restock_lines_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_orders" ADD CONSTRAINT "restock_orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "restock_lines_order_idx" ON "restock_lines" USING btree ("restock_order_id");--> statement-breakpoint
CREATE INDEX "restock_lines_variant_idx" ON "restock_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "restock_orders_shop_number_uq" ON "restock_orders" USING btree ("shop_id","number");--> statement-breakpoint
CREATE INDEX "restock_orders_shop_status_idx" ON "restock_orders" USING btree ("shop_id","status");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_restock_order_id_restock_orders_id_fk" FOREIGN KEY ("restock_order_id") REFERENCES "public"."restock_orders"("id") ON DELETE set null ON UPDATE no action;