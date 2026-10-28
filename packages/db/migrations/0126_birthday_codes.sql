ALTER TABLE "customers" ADD COLUMN "birthday" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "birthday_sent_year" integer;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "birthday_offer" jsonb;