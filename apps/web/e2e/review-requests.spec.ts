import { expect, test } from "@playwright/test";

// Review requests go out from the daily job a few days after delivery, so what they say is
// covered by the core tests. Here: the merchant picks the wait, or turns them off.

test("a merchant sets when buyers are asked for a review", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Reviews ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Reviews/ })).toBeVisible();

  await page.goto("/admin/reviews");
  const section = page.getByRole("region", { name: "Review requests" });
  await expect(section.getByLabel("Email buyers for a review")).toBeChecked();
  await expect(section.getByLabel("Days after delivery")).toHaveValue("7");
  await section.getByLabel("Days after delivery").fill("3");
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByText("Saved. Buyers are asked 3 days after their order arrives.")).toBeVisible();
  await section.getByLabel("Email buyers for a review").uncheck();
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByText("Saved. Buyers aren't emailed for a review.")).toBeVisible();
  await page.reload();
  await expect(section.getByLabel("Email buyers for a review")).not.toBeChecked();

  // It's in the activity log.
  await page.goto("/admin/activity");
  await expect(page.getByText("Turned off review requests")).toBeVisible();
});
