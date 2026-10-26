import { expect, test } from "@playwright/test";

// The Monday summary email is on for owners, and each person can turn it off per store. What it
// says is covered by the core tests, since it sums up a week that has already ended.

test("an owner turns the Monday summary off and on again", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ws-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Weekly ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Weekly/ })).toBeVisible();

  await page.goto("/admin/account");
  const section = page.getByRole("region", { name: "Monday summary" });
  const box = section.getByLabel(`Email me a summary of Weekly ${id} every Monday`);
  await expect(box).toBeChecked();
  await box.uncheck();
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByText(`Saved. You won't get Weekly ${id}'s summary any more.`)).toBeVisible();
  await page.reload();
  await expect(box).not.toBeChecked();
  await box.check();
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByText(`Saved. You'll get Weekly ${id}'s summary on Mondays.`)).toBeVisible();
});
