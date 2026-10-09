CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"items" jsonb NOT NULL,
	"suggested_minor" bigint NOT NULL,
	"resolved_minor" bigint,
	"merchant_message" text,
	"refund_id" uuid,
	"gift_card_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "return_window_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "return_instructions" text;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_requests_shop_idx" ON "return_requests" USING btree ("shop_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "return_requests_one_open_uq" ON "return_requests" USING btree ("order_id") WHERE "return_requests"."status" in ('requested', 'approved');