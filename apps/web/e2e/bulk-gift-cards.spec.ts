import { expect, test } from "@playwright/test";

// Gift cards for many people: the merchant pastes rows of email, amount and name, checks the
// total, and everyone gets their own code.

test("a merchant gives gift cards to a whole team at once", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bulk-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Team ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Team/ })).toBeVisible();

  await page.goto("/admin/gift-cards");
  const bulk = page.getByRole("region", { name: "Give gift cards to many people" });
  await bulk.getByLabel("People and amounts").fill(`email\tamount\tname\nsam-${id}@example.com\t50\tSam\nalex-${id}@example.com\tfifty\tAlex`);
  await bulk.getByRole("button", { name: "Check" }).click();
  await expect(bulk.getByRole("alert")).toContainText("Row 3: enter the amount like 50 or 25.00.");

  await bulk.getByLabel("People and amounts").fill(`sam-${id}@example.com\t50\tSam\nalex-${id}@example.com\t25\tAlex`);
  await bulk.getByLabel("From (optional)").fill("Acme Inc");
  await bulk.getByLabel("Message (optional)").fill("Happy holidays from all of us!");
  await bulk.getByRole("button", { name: "Check" }).click();
  await expect(bulk.getByText("2 gift cards, $75.00 in all, emailed now.")).toBeVisible();
  // Changing anything asks for another check.
  await bulk.getByLabel("Message (optional)").fill("Happy holidays!");
  await expect(bulk.getByRole("button", { name: "Send 2 gift cards" })).toHaveCount(0);
  await bulk.getByRole("button", { name: "Check" }).click();
  await bulk.getByRole("button", { name: "Send 2 gift cards" }).click();
  await expect(bulk.getByText("2 of 2 gift cards ($75.00 in all) were emailed.")).toBeVisible();

  const list = page.getByRole("region", { name: "Gift cards", exact: true });
  await expect(list.getByText(`sam-${id}@example.com · Given by you, from Acme Inc`)).toBeVisible();
  await expect(list.getByText(`alex-${id}@example.com · Given by you, from Acme Inc`)).toBeVisible();
});
