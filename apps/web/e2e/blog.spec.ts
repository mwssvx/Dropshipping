import { expect, test, type Page } from "@playwright/test";

// The store blog: the merchant asks the AI writer for a draft, edits and publishes it, and buyers
// read it at /blog with the featured products underneath. Drafts never show on the store.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchantWithLamp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bl-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Journal ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Journal/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");
}

test("the AI writer drafts a post, the merchant publishes it, and buyers read it", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const store = await newMerchantWithLamp(page, id);
  await page.goto("/admin/blog");
  await page.getByLabel("What should it be about?").fill("How to pick a night light for a kid's room");
  await page.getByText("Pick products to feature").click();
  await page.getByLabel("Sunset Projection Lamp").check();
  await page.getByRole("button", { name: "Write a draft" }).click();
  await expect(page.getByText("The AI writer drafted this post.")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("How to pick a night light for a kid's room");
  await expect(page.getByLabel("Post")).toHaveValue(/## Our picks/);
  await expect(page.getByLabel("Sunset Projection Lamp")).toBeChecked();
  await shot(page, "113-blog-ai-draft");

  // Drafts don't show on the store.
  const buyer = await page.context().browser()!.newPage();
  await buyer.goto(`${store}/blog`);
  await expect(buyer.getByText("Nothing here yet.")).toBeVisible();

  await page.getByLabel("Title").fill("Picking a night light for a kid's room");
  await page.getByLabel("Published").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/admin/blog");
  await expect(page.getByRole("row", { name: /Picking a night light/ })).toContainText("Published");

  await buyer.reload();
  await buyer.getByRole("link", { name: "Picking a night light for a kid's room" }).click();
  await expect(buyer.getByRole("heading", { level: 1, name: "Picking a night light for a kid's room" })).toBeVisible();
  await expect(buyer.getByRole("heading", { name: "Our picks" })).toBeVisible();
  await expect(buyer.getByRole("listitem").filter({ hasText: /Sunset Projection Lamp, from/ })).toBeVisible();
  const featured = buyer.getByRole("region", { name: "In this post" });
  await featured.getByRole("link", { name: /Sunset Projection Lamp/ }).click();
  await expect(buyer.getByRole("heading", { level: 1, name: "Sunset Projection Lamp" })).toBeVisible();
  await buyer.goBack();
  await shot(buyer, "114-blog-post");

  // Search engines and feed readers find it.
  const feed = await buyer.request.get(`${store}/blog/feed.xml`);
  expect(await feed.text()).toContain("<title>Picking a night light for a kid&apos;s room</title>".replace("&apos;", "'"));
  const sitemap = await buyer.request.get(`${store}/sitemap.xml`);
  expect(await sitemap.text()).toMatch(/\/blog\/how-to-pick-a-night-light-for-a-kid-s-room</);
  await buyer.close();
});

test("a merchant writes a post by hand, and an empty post can't be published", async ({ page }, info) => {
  const id = `${info.project.name}-hand-${Date.now()}`;
  const store = await newMerchantWithLamp(page, id);
  await page.goto("/admin/blog/new");
  await page.getByLabel("Title").fill("Our story");
  await page.getByLabel("Published").check();
  await page.getByRole("button", { name: "Save post" }).click();
  await expect(page.getByText("Write a bit more before publishing")).toBeVisible();
  // What was typed stays.
  await expect(page.getByLabel("Title")).toHaveValue("Our story");
  await expect(page.getByLabel("Published")).toBeChecked();
  await page.getByLabel("Post").fill("We started in a garage with one lamp and a lot of hope.\n\n## Why lamps\n\n- They make rooms kinder\n- They're easy to love");
  await page.getByRole("button", { name: "Save post" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const buyer = await page.context().browser()!.newPage();
  await buyer.goto(`${store}/blog/our-story`);
  await expect(buyer.getByRole("heading", { name: "Why lamps" })).toBeVisible();
  await expect(buyer.getByRole("listitem").filter({ hasText: "They make rooms kinder" })).toBeVisible();
  await buyer.close();

  await page.getByRole("button", { name: "Delete this post" }).click();
  await expect(page.getByText("No posts yet.")).toBeVisible();
});

test("a post scheduled for later waits, then goes up when the time is cleared", async ({ page }, info) => {
  const id = `${info.project.name}-later-${Date.now()}`;
  const store = await newMerchantWithLamp(page, id);
  await page.goto("/admin/blog/new");
  await page.getByLabel("Title").fill("Winter is coming");
  await page.getByLabel("Post").fill("Long nights are lamp season. Here is what we are bringing in for the cold months ahead.");
  await page.getByLabel("Published").check();
  // Tomorrow at 9:00 in the merchant's own time zone.
  const tomorrow = await page.evaluate(() => {
    const d = new Date(Date.now() + 86_400_000);
    d.setHours(9, 0, 0, 0);
    return { local: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T09:00`, label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) };
  });
  await page.getByLabel("Publish on (optional)").fill(tomorrow.local);
  await page.getByRole("button", { name: "Save post" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  // The time comes back in the same zone, and there's nothing to view yet.
  await expect(page.getByLabel("Publish on (optional)")).toHaveValue(tomorrow.local);
  await expect(page.getByRole("link", { name: "View ↗" })).toHaveCount(0);
  await page.goto("/admin/blog");
  await expect(page.getByRole("row", { name: /Winter is coming/ })).toContainText("Scheduled for");

  const buyer = await page.context().browser()!.newPage();
  await buyer.goto(`${store}/blog`);
  await expect(buyer.getByText("Nothing here yet.")).toBeVisible();
  expect((await buyer.goto(`${store}/blog/winter-is-coming`))!.status()).toBe(404);

  // Clearing the time publishes it on save.
  await page.getByRole("link", { name: "Winter is coming" }).click();
  await expect(page.getByLabel("Publish on (optional)")).toHaveValue(tomorrow.local);
  await page.getByLabel("Publish on (optional)").fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("link", { name: "View ↗" })).toBeVisible();
  await buyer.goto(`${store}/blog`);
  await expect(buyer.getByRole("link", { name: "Winter is coming" })).toBeVisible();
  await buyer.close();

  // Once it's up, it can go to subscribers as a campaign, already written.
  await page.getByRole("link", { name: "Email to subscribers" }).click();
  await expect(page.getByLabel("Subject")).toHaveValue("Winter is coming");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(/^Hi \{first_name\},\n\nNew on our blog: Winter is coming\n\nLong nights are lamp season\./);
  await expect(page.getByLabel("Goes to")).toHaveValue("/blog/winter-is-coming");
  await expect(page.getByLabel("Link text (optional)")).toHaveValue("Read the post");
});
