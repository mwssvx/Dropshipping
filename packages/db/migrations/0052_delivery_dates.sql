ALTER TABLE "shops" ADD COLUMN "delivery_estimates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "processing_days" integer DEFAULT 2 NOT NULL;