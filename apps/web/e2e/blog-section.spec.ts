import { expect, test } from "@playwright/test";

// The home page's blog section: the newest published posts, filled in by themselves.

test("the newest blog post shows on the home page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`blogrow-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Blogrow ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Blogrow/ })).toBeVisible();
  const handle = `blogrow-${id}`.toLowerCase();

  // With no posts yet the section stays out of the preview.
  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("blog_posts");
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await expect(preview.getByRole("region", { name: "From the blog" })).toHaveCount(0);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  await page.goto("/admin/blog");
  await page.getByLabel("What should it be about?").fill("How to pick a night light for a kid's room");
  await page.getByRole("button", { name: "Write a draft" }).click();
  await expect(page.getByText("The AI writer drafted this post.")).toBeVisible();
  await page.getByLabel("Title").fill("Picking a night light for a kid's room");
  await page.getByLabel("Published").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`/s/${handle}`);
  const row = buyer.getByRole("region", { name: "From the blog" });
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByText(/\d+ min read/)).toBeVisible();
  await expect(row.getByRole("link", { name: "View all" })).toHaveAttribute("href", new RegExp(`/s/${handle}/blog$`));
  await row.getByRole("link", { name: "Picking a night light for a kid's room" }).click();
  await expect(buyer.getByRole("heading", { level: 1, name: "Picking a night light for a kid's room" })).toBeVisible();
  await buyer.context().close();
});
