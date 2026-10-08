CREATE TABLE "campaign_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"customer_id" uuid,
	"email" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"button_label" text,
	"button_path" text,
	"audience" text DEFAULT 'subscribers' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "accepts_marketing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "marketing_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "unsubscribed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_token" text DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "mailing_address" text;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sends_campaign_email_uq" ON "campaign_sends" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "campaign_sends_status_idx" ON "campaign_sends" USING btree ("status","campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_shop_idx" ON "campaigns" USING btree ("shop_id","created_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_email_token_unique" UNIQUE("email_token");