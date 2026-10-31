import { expect, test } from "@playwright/test";

// When the merchant replies to a review, the buyer who wrote it gets the reply by email once the
// review is live. Editing the reply later doesn't email again.

test("the buyer hears about the store's reply to their review", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Replies ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Replies/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill(`ada-${id}@example.com`);
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
  const form = buyer.getByRole("form", { name: "Review Sunset Projection Lamp" });
  await form.getByLabel("4 stars").check({ force: true });
  await form.getByLabel("Your review").fill("Lovely colours, a little smaller than I thought.");
  await form.getByLabel("Name to show").fill("Ada B.");
  await form.getByRole("button", { name: "Send review" }).click();
  await expect(buyer.getByText(/you gave it 4 of 5 stars/)).toBeVisible();

  const subject = `Replies ${id} replied to your review`;
  const inbox = await buyer.context().newPage();
  const mails = async () => {
    await inbox.goto("/dev/mail");
    return inbox.getByRole("article", { name: subject }).filter({ hasText: `ada-${id}@example.com` });
  };

  // A reply to a review still waiting for approval waits too.
  await page.goto("/admin/reviews");
  const review = page.getByRole("listitem", { name: "Review by Ada B." });
  await review.getByRole("button", { name: "Reply" }).click();
  await expect(review.getByText("The buyer gets your first reply by email once the review is published.")).toBeVisible();
  await review.getByLabel("Public reply").fill("Thanks Ada! A bigger one is coming in May.");
  await review.getByRole("button", { name: "Save reply" }).click();
  await expect(review.getByText("Your reply: Thanks Ada! A bigger one is coming in May.")).toBeVisible();
  await expect(await mails()).toHaveCount(0);

  await review.getByRole("button", { name: "Publish" }).click();
  await expect(async () => expect(await mails()).toHaveCount(1, { timeout: 1000 })).toPass({ timeout: 10_000 });
  const mail = await mails();
  await expect(mail).toContainText("> Lovely colours, a little smaller than I thought.");
  await expect(mail).toContainText("Thanks Ada! A bigger one is coming in May.");
  await expect(mail).toContainText("/products/sunset-projection-lamp#review-");

  // Editing the reply doesn't email again.
  await page.goto("/admin/reviews?show=published");
  const live = page.getByRole("listitem", { name: "Review by Ada B." });
  await live.getByRole("button", { name: "Edit reply" }).click();
  await live.getByLabel("Public reply").fill("Thanks Ada! The bigger one is out in June.");
  await live.getByRole("button", { name: "Save reply" }).click();
  await expect(live.getByText("Your reply: Thanks Ada! The bigger one is out in June.")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(await mails()).toHaveCount(1);
  await buyer.context().close();
});
