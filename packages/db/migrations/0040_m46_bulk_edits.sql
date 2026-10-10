CREATE TABLE "bulk_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"action" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"products" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bulk_edits" ADD CONSTRAINT "bulk_edits_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_edits" ADD CONSTRAINT "bulk_edits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_edits_shop_idx" ON "bulk_edits" USING btree ("shop_id","created_at");