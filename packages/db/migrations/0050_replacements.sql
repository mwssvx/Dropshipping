ALTER TABLE "orders" ADD COLUMN "replaces_order_id" uuid;--> statement-breakpoint
ALTER TABLE "return_requests" ADD COLUMN "replacement_order_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_replaces_order_id_orders_id_fk" FOREIGN KEY ("replaces_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_replacement_order_id_orders_id_fk" FOREIGN KEY ("replacement_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_replaces_idx" ON "orders" USING btree ("replaces_order_id");