import { expect, test } from "@playwright/test";

// Running late: the merchant turns on an email to buyers whose order still hasn't shipped after a
// number of days, with a few words of their own, and the setting stays.

test("turn on the running late email for buyers", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`late-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Late ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Late/ })).toBeVisible();

  await page.goto("/admin/shipping");
  await page.waitForLoadState("load");
  await page.getByLabel("Email buyers when their order is running late").check();
  await page.getByLabel("When it hasn't shipped after").selectOption("5");
  await page.getByLabel("Add a few words (optional)").fill("Our supplier is very busy before the holidays.");
  await page.getByRole("button", { name: "Save running late email" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved. Buyers hear from you when their order hasn't shipped 5 days after paying.");

  // Shipped parcels that are late too.
  const transit = page.getByLabel("Also when a shipped parcel is past its delivery date");
  await expect(transit).not.toBeChecked();
  await transit.check();
  await page.getByRole("button", { name: "Save running late email" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved. Buyers hear from you when their order hasn't shipped 5 days after paying, and when a shipped parcel is past its delivery date.");

  await page.reload();
  await expect(page.getByLabel("Also when a shipped parcel is past its delivery date")).toBeChecked();
  await expect(page.getByLabel("Email buyers when their order is running late")).toBeChecked();
  await expect(page.getByLabel("When it hasn't shipped after")).toHaveValue("5");
  await expect(page.getByLabel("Add a few words (optional)")).toHaveValue("Our supplier is very busy before the holidays.");

  await page.getByLabel("Email buyers when their order is running late").uncheck();
  await page.getByRole("button", { name: "Save running late email" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved. Buyers don't get a running late email.");
});
