ALTER TABLE "orders" ADD COLUMN "visit_post_id" uuid;--> statement-breakpoint
ALTER TABLE "storefront_events" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_visit_post_id_blog_posts_id_fk" FOREIGN KEY ("visit_post_id") REFERENCES "public"."blog_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_events" ADD CONSTRAINT "storefront_events_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_events_post_idx" ON "storefront_events" USING btree ("post_id");