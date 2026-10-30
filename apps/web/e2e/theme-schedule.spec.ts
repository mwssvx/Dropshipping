import { expect, test } from "@playwright/test";

// Scheduling a look: a copy of the theme draft goes live by itself at a chosen time and can
// switch back after (a Black Friday look). Going live is covered in core; here the merchant sets,
// checks and cancels a schedule.

test("a merchant schedules a holiday look and cancels it", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sched-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Sched ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Sched/ })).toBeVisible();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  const panel = page.getByRole("region", { name: "Schedule a new look" });
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await panel.getByLabel("Goes live").fill(`${day(10)}T00:00`);
  await panel.getByLabel("Switch back (optional)").fill(`${day(5)}T00:00`);
  await panel.getByRole("button", { name: "Schedule this draft" }).click();
  await expect(panel.locator(".banner-critical")).toHaveText("Switch back after the new look goes live.");

  await panel.getByLabel("Switch back (optional)").fill(`${day(14)}T00:00`);
  await panel.getByRole("button", { name: "Schedule this draft" }).click();
  await expect(panel.getByText(/goes live on \w+, \w+ \d+, 12:00 AM, and the look before it comes back on \w+, \w+ \d+, 12:00 AM/)).toBeVisible();

  // It's still there after a reload, and can be called off.
  await page.reload();
  await page.getByRole("button", { name: "Schedule (set)" }).click();
  await expect(panel.getByText(/goes live on \w+, \w+ \d+, 12:00 AM/)).toBeVisible();
  await panel.getByRole("button", { name: "Cancel schedule" }).click();
  await expect(panel.getByText(/goes live on/)).toHaveCount(0);
  await expect(panel.getByText(/Get a holiday look ready now/)).toBeVisible();
});
