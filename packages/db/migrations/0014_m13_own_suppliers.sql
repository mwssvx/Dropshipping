DROP INDEX "suppliers_shop_provider_uq";--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "portal_token" text DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_portal_token_unique" UNIQUE("portal_token");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_shop_provider_contact_uq" UNIQUE NULLS NOT DISTINCT("shop_id","provider","contact_email");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_email_has_contact" CHECK ("suppliers"."provider" <> 'email' or ("suppliers"."contact_email" is not null and "suppliers"."name" is not null));