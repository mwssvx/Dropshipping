CREATE TABLE "account_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"kind" text NOT NULL,
	"explanation" text NOT NULL,
	"holds_payouts" boolean DEFAULT true NOT NULL,
	"due_by" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"provider_payout_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" text NOT NULL,
	"arrival_date" date,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_provider_payout_id_unique" UNIQUE("provider_payout_id")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"platform_fee_refunded_minor" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"provider_refund_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_provider_refund_id_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "refunds_amount_pos" CHECK ("refunds"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "requirement_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"provider_file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "emails_order_kind_uq";--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "ref" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "platform_fee_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "processing_fee_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "charges_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "payouts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "billing_customer_id" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "billing_subscription_id" text;--> statement-breakpoint
ALTER TABLE "account_requirements" ADD CONSTRAINT "account_requirements_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_uploads" ADD CONSTRAINT "requirement_uploads_requirement_id_account_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."account_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_requirements_open_uq" ON "account_requirements" USING btree ("shop_id","provider_key") WHERE "account_requirements"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "account_requirements_shop_idx" ON "account_requirements" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "payouts_shop_created_idx" ON "payouts" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emails_order_kind_ref_uq" ON "emails" USING btree ("order_id","kind","ref");--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_billing_customer_id_unique" UNIQUE("billing_customer_id");--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_billing_subscription_id_unique" UNIQUE("billing_subscription_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_refund_within_total" CHECK ("orders"."refunded_minor" >= 0 and "orders"."refunded_minor" <= "orders"."total_minor");