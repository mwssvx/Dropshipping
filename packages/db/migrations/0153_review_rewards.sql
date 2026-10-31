ALTER TABLE "reviews" ADD COLUMN "rewarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "review_reward_percent" integer;