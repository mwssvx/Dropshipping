CREATE TABLE "reward_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"ref_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "rewards_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "rewards_earn_rate" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "rewards_value_minor" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "reward_entries" ADD CONSTRAINT "reward_entries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entries" ADD CONSTRAINT "reward_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entries" ADD CONSTRAINT "reward_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reward_entries_customer_idx" ON "reward_entries" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_entries_order_uq" ON "reward_entries" USING btree ("order_id","kind","ref_id");