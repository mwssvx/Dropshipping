ALTER TABLE "customers" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;