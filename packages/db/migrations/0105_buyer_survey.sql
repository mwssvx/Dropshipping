ALTER TABLE "orders" ADD COLUMN "survey_answer" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "survey_other" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "survey" jsonb;