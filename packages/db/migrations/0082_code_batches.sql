CREATE TABLE "code_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"count" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "code_batches" ADD CONSTRAINT "code_batches_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_batch_id_code_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."code_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discounts_batch_idx" ON "discounts" USING btree ("batch_id");