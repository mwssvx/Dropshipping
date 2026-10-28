import { expect, test } from "@playwright/test";

// Holiday checklist: from October to Christmas Eve the home page points at a checklist of the
// season's settings, each ticked from the store's own state and linking to where it's set.

const inSeason = (d: Date) => d.getUTCMonth() === 9 || d.getUTCMonth() === 10 || (d.getUTCMonth() === 11 && d.getUTCDate() <= 24);

test("the holiday checklist ticks what's set up and links to the rest", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`checklist-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Checklist ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Checklist/ })).toBeVisible();

  if (inSeason(new Date())) {
    const card = page.getByRole("region", { name: "Get ready for the holidays" });
    await expect(card).toContainText("3 of 10 done. Next: set a last day to order.");
    await card.getByRole("link", { name: "Open the holiday checklist" }).click();
  } else {
    await page.goto("/admin/holidays");
  }
  await expect(page.getByRole("heading", { name: "Holiday checklist" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("3 of 10 done");
  await expect(page.getByRole("listitem", { name: "Show delivery dates: done" })).toBeVisible();
  await page.getByRole("listitem", { name: "Email buyers when an order runs late: to do" }).getByRole("link").click();
  await expect(page).toHaveURL(/\/admin\/shipping#late-heading$/);
  await page.waitForLoadState("load");
  await page.getByLabel("Email buyers when their order is running late").check();
  await page.getByRole("button", { name: "Save running late email" }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await page.goto("/admin/holidays");
  await expect(page.getByRole("status")).toHaveText("4 of 10 done");
  await expect(page.getByRole("listitem", { name: "Email buyers when an order runs late: done" })).toContainText("hasn't shipped after 7 days");
});
