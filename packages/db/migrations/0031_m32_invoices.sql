CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"refund_id" uuid,
	"number" text NOT NULL,
	"seq" integer NOT NULL,
	"seller" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_refund_when_credit" CHECK (("invoices"."kind" = 'credit_note') = ("invoices"."refund_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "invoice_legal_name" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "invoice_address" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "invoice_prefix" text DEFAULT 'INV-' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "invoice_next_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "invoice_footer" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_shop_seq_uq" ON "invoices" USING btree ("shop_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_order_invoice_uq" ON "invoices" USING btree ("order_id") WHERE "invoices"."kind" = 'invoice';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_refund_uq" ON "invoices" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "invoices_shop_issued_idx" ON "invoices" USING btree ("shop_id","issued_at");