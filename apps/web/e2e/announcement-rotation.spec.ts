import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// An announcement bar with several messages takes turns showing them. Shoppers can step through
// them or pause, and shoppers who ask for less motion get it paused from the start.

test("a merchant's announcement bar takes turns with three messages", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`turns-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Turns ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Turns/ })).toBeVisible();
  const handle = `turns-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("announcement");
  await page.getByLabel("Message", { exact: true }).fill("Free shipping over $50");
  await page.getByRole("button", { name: "Add a message" }).click();
  await page.getByLabel("Extra message 1").fill("30-day returns");
  await page.getByLabel("Extra message link 1").fill("/collections/all");
  await page.getByRole("button", { name: "Add a message" }).click();
  await page.getByLabel("Extra message 2").fill("Gift wrap for $3");
  await page.getByLabel("Seconds per message").fill("3");
  // The preview steps through them like a shopper would.
  await preview.getByRole("button", { name: "Pause announcements" }).click();
  await expect(preview.getByText("Free shipping over $50")).toBeVisible();
  await preview.getByRole("button", { name: "Next announcement" }).click();
  await expect(preview.getByRole("link", { name: "30-day returns" })).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  // A shopper sees them change by themselves, and can go back or pause.
  const buyerContext = await browser.newContext({ ...info.project.use });
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  await expect(buyer.getByText("Free shipping over $50")).toBeVisible();
  // The first turn comes 3 seconds after the page wakes up, which can take a while on a busy machine.
  await expect(buyer.getByRole("link", { name: "30-day returns" })).toBeVisible({ timeout: 15_000 });
  await expect(buyer.getByRole("link", { name: "30-day returns" })).toHaveAttribute("href", `/s/${handle}/collections/all`);
  await buyer.getByRole("button", { name: "Pause announcements" }).click();
  await buyer.mouse.move(0, 400);
  await buyer.getByRole("button", { name: "Previous announcement" }).click();
  await buyer.getByRole("button", { name: "Previous announcement" }).click();
  await expect(buyer.getByText("Gift wrap for $3")).toBeVisible();
  await buyer.mouse.move(0, 400);
  // Paused, it stays put.
  await buyer.waitForTimeout(3500);
  await expect(buyer.getByText("Gift wrap for $3")).toBeVisible();
  await buyer.getByRole("button", { name: "Play announcements" }).click();
  await buyer.mouse.move(0, 400);
  await expect(buyer.getByText("Free shipping over $50")).toBeVisible({ timeout: 15_000 });
  await buyerContext.close();

  // Less motion: it waits for the shopper.
  const calm = await browser.newContext({ ...info.project.use, reducedMotion: "reduce" });
  const still = await calm.newPage();
  await still.goto(`/s/${handle}`);
  // The page renders with a pause button; once it wakes up and sees the setting, it shows play.
  await expect(still.getByRole("button", { name: "Play announcements" })).toBeVisible({ timeout: 15_000 });
  await still.waitForTimeout(3500);
  await expect(still.getByText("Free shipping over $50")).toBeVisible();
  // The bar's buttons pass the same accessibility check as the rest of the store.
  const axe = await new AxeBuilder({ page: still }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await calm.close();
});
