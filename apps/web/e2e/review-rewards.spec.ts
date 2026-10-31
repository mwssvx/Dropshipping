import { expect, test } from "@playwright/test";

// Thank-you codes: the store offers 15% off for a review, the buyer reviews, gets the code by
// email, and the review says on the store that it earned one.

test("a buyer gets a thank-you code for a review, and the review says so", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Thanks ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Thanks/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  // Publish reviews straight away, and thank buyers with 15% off.
  await page.goto("/admin/reviews");
  const reward = page.getByRole("region", { name: "Thank-you code" });
  await reward.getByLabel("Thank buyers for a review with").check();
  await reward.getByLabel("Thank-you percent off").fill("15");
  await reward.getByRole("button", { name: "Save" }).click();
  await expect(reward.getByText("Saved. Buyers get 15% off their next order for a review.")).toBeVisible();
  await page.getByLabel("Publish new reviews straight away").check();
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByLabel("Publish new reviews straight away")).toBeChecked({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill("ada@example.com");
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const orderPage = buyer.url();

  // The demo supplier ships at once; once tracking is in, the buyer can review.
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Check for tracking now" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Check for tracking now" }).click();
  await expect(page.getByText(/Shipped with Demo Post/).first()).toBeVisible();

  await buyer.goto(orderPage);
  await expect(buyer.getByText("Leave a review, good or bad, and we'll email you 15% off your next order as a thank you.")).toBeVisible();
  const form = buyer.getByRole("form", { name: "Review Sunset Projection Lamp" });
  await form.getByLabel("3 stars").check({ force: true });
  await form.getByLabel("Your review").fill("Nice colours, a bit dim in a bright room.");
  await form.getByLabel("Name to show").fill("Ada B.");
  await form.getByRole("button", { name: "Send review" }).click();
  await expect(buyer.getByText(/you gave it 3 of 5 stars\. Thank you! We've emailed you 15% off your next order\./)).toBeVisible();

  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const mail = inbox.getByRole("article").filter({ hasText: `Thanks ${id}` }).filter({ has: inbox.getByRole("heading", { name: "Thanks for your review: 15% off your next order" }) });
  await expect(mail).toHaveCount(1);
  await expect(mail).toContainText(/THANKS-[A-Z2-9]{6}/);
  await inbox.close();

  await buyer.goto(store);
  await expect(buyer.getByRole("listitem", { name: /Ada B\./ }).or(buyer.locator('li[id^="review-"]').filter({ hasText: "Ada B." })).first()).toContainText("Got a thank-you code for reviewing");
  await page.goto("/admin/reviews");
  await expect(page.getByRole("region", { name: "Thank-you code" })).toContainText("1 code sent, 0 used");
});
