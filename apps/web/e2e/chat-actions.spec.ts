import { expect, test, type Page } from "@playwright/test";

// From the chat, the Assistant sets up a discount code and a collection; each waits for the
// owner's OK with a preview of what it will do.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
};

test("the assistant sets up a discount and a collection, with a preview to approve", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`chat-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Chat ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Chat/ })).toBeVisible();

  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();

  await page.goto("/admin/assistant");
  await page.getByLabel("Message the assistant").fill("Create a discount code WELCOME10 for 10% off orders over $40 for 14 days");
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.getByRole("article", { name: "New discount code WELCOME10: 10% off over 40" });
  await expect(card.getByRole("list", { name: "What it will do" })).toContainText("Buyers who enter WELCOME10 get 10% off orders over $40.00.");
  await shot(page, "151-chat-discount-preview");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Done.").first()).toBeVisible();
  await page.goto("/admin/marketing");
  await expect(page.getByText("WELCOME10").first()).toBeVisible();

  await page.goto("/admin/assistant");
  await page.getByLabel("Message the assistant").fill("Make a collection of lamp products called Cozy nights");
  await page.getByRole("button", { name: "Send" }).click();
  const coll = page.getByRole("article", { name: "New collection “Cozy nights” with 1 product" });
  await expect(coll).toContainText("1 product: Sunset Projection Lamp.");
  await coll.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Done.").first()).toBeVisible();
  await page.goto("/admin/collections");
  await expect(page.getByText("Cozy nights").first()).toBeVisible();
});
