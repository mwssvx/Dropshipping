import { expect, test, type Page } from "@playwright/test";

// Help from a person: a merchant writes to our team without going through the assistant, sees by
// when a real person answers, and staff see who's waiting and how close they are to the promise.

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
}

test("a merchant writes to our team and a person answers within the promise", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const store = `Help Desk ${id}`;
  await signUp(page, `help-${id}@example.com`);
  await page.getByLabel("Store name").fill(store);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Help Desk/ })).toBeVisible();

  // The promise is on the pricing page and in the admin.
  await page.goto("/pricing");
  await expect(page.getByRole("listitem", { name: "Free plan" })).toContainText("A person answers within 24 hours");
  await expect(page.getByRole("listitem", { name: "Scale plan" })).toContainText("A person answers within 4 hours");

  await page.goto("/admin/account");
  await page.getByRole("link", { name: "Write to our team" }).click();
  await expect(page.getByRole("region", { name: "Our promise" })).toContainText("A real person from our team answers within 24 hours");
  await page.getByLabel("What it's about").fill("My payout hasn't arrived");
  await page.getByLabel("What happened").fill("The Money page says it was sent on Monday but it isn't in my bank.");
  await page.getByRole("button", { name: "Send to our team" }).click();
  await expect(page.getByRole("status")).toContainText("A person from our team answers here");
  const request = page.getByRole("article", { name: "My payout hasn't arrived" });
  await expect(request).toContainText(/A person answers by/);

  // Staff see it with how long they have left, and answer.
  const staff = await (await browser.newContext({ ...info.project.use })).newPage();
  await signUp(staff, `staff-help-${info.project.name}@example.com`);
  await expect(staff.getByLabel("Store name")).toBeVisible();
  await staff.goto("/staff");
  await expect(staff.getByLabel("Answer times")).toContainText("Promise: a person answers within 24 hours on Free and Starter");
  const ticket = staff.getByRole("article").filter({ hasText: store });
  await expect(ticket).toContainText(/Answer within (2[34]|1) hours?/);
  await ticket.getByLabel(/Reply to the merchant/).fill("Your bank holds incoming payouts for a day. It lands tomorrow.");
  await ticket.getByRole("button", { name: "Send", exact: true }).click();
  await expect(ticket).toHaveCount(0);
  await staff.reload();
  await expect(staff.getByLabel("Answer times")).toContainText(/Last 30 days: \d+ of \d+ answers on time/);

  // The merchant sees the answer on the request, and can add to it.
  await page.reload();
  await expect(request).toContainText("Answered");
  await expect(request).toContainText("lands tomorrow");
  await request.getByLabel("Add to this request").fill("It still isn't there.");
  await request.getByRole("button", { name: "Add to this request" }).click();
  await expect(request).toContainText(/A person answers by/);
});
