CREATE TABLE "gift_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"last4" text NOT NULL,
	"currency" char(3) NOT NULL,
	"initial_minor" bigint NOT NULL,
	"balance_minor" bigint NOT NULL,
	"email" text NOT NULL,
	"note" text,
	"source_order_id" uuid,
	"source_index" integer,
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_balance_ok" CHECK ("gift_cards"."balance_minor" >= 0 and "gift_cards"."balance_minor" <= "gift_cards"."initial_minor")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gift_card" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "gift_card_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_shop_code_uq" ON "gift_cards" USING btree ("shop_id","code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_source_uq" ON "gift_cards" USING btree ("source_order_id","source_index");--> statement-breakpoint
CREATE INDEX "gift_cards_shop_idx" ON "gift_cards" USING btree ("shop_id","created_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_gift_card_within_total" CHECK ("orders"."gift_card_minor" >= 0 and "orders"."gift_card_minor" <= "orders"."total_minor");