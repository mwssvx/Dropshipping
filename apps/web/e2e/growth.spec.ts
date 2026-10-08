import { expect, test, type Page } from "@playwright/test";

// Milestone 7 (part 1): discount codes, checkout reminders, reviews from real buyers, and
// "goes well with" suggestions. Set SCREENSHOTS_DIR to also save the screens for review.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchant(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`m7-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Glow Goods ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Glow Goods/ })).toBeVisible();
}

async function importDemo(page: Page, name: RegExp) {
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return { admin: page.url().split("?")[0]!, store: (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))! };
}

async function fillAddress(page: Page, email: string, name: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Address", { exact: true }).fill("1 Main St");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("State or region").fill("TX");
  await page.getByLabel("Postal code").fill("78701");
  await page.getByRole("button", { name: "Continue to payment" }).click();
}

test("discount codes, reminders, reviews and suggestions", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);
  await importDemo(page, /magnetic phone stand/i);
  const lamp = await importDemo(page, /sunset projection lamp/i);

  // Suggest the phone stand with the lamp.
  await page.goto(lamp.admin);
  await page.getByLabel("Suggest").selectOption({ label: "Magnetic Phone Stand" });
  await page.getByRole("button", { name: "Save suggestion" }).click();
  await expect(page.getByLabel("Suggest")).toHaveValue(/.+/);

  // A 10% code, once per buyer.
  await page.getByRole("link", { name: "Marketing" }).first().click();
  await page.getByLabel("Code", { exact: true }).fill("welcome10");
  await page.getByLabel("Percent").fill("10");
  await page.getByLabel("Once per buyer").check();
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("Code created. Buyers can use it now.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "WELCOME10" })).toContainText("10% off");
  await expect(page.getByRole("listitem").filter({ hasText: "WELCOME10" })).toContainText("Live");
  await shot(page, "66-marketing-codes");

  // The buyer sees the suggestion, adds both, and uses the code.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp.store);
  await expect(buyer.getByRole("heading", { name: "Goes well with" })).toBeVisible();
  await expect(buyer.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("button", { name: "Add Magnetic Phone Stand to cart" }).click();
  await expect(buyer.getByText("Magnetic Phone Stand").first()).toBeVisible();
  await expect(buyer.getByRole("heading", { name: "Goes well with" })).toHaveCount(0);
  await buyer.getByLabel("Discount code").fill("nope");
  await buyer.getByRole("button", { name: "Apply" }).click();
  await expect(buyer.getByText(`"NOPE" isn't a valid code.`)).toBeVisible();
  await buyer.getByLabel("Discount code").fill("welcome10");
  await buyer.getByRole("button", { name: "Apply" }).click();
  await expect(buyer.getByText("Discount (WELCOME10)")).toBeVisible();
  await shot(buyer, "67-cart-discount");
  await buyer.getByRole("link", { name: "Check out" }).click();
  await fillAddress(buyer, "ada@example.com", "Ada Buyer");
  await expect(buyer.getByText("Discount (WELCOME10)")).toBeVisible();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const orderPage = buyer.url();

  // The order shows the discount. The demo supplier ships at once; once tracking is in, the buyer can review.
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await expect(page.getByText("Discount (WELCOME10)")).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Check for tracking now" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Check for tracking now" }).click();
  await expect(page.getByText(/Shipped with Demo Post/).first()).toBeVisible();
  await buyer.goto(orderPage);
  await expect(buyer.getByRole("heading", { name: "How was it?" })).toBeVisible();
  const form = buyer.getByRole("form", { name: "Review Sunset Projection Lamp" });
  await form.getByLabel("4 stars").check({ force: true });
  await form.getByLabel("Your review").fill("Lovely warm light, a bit smaller than I thought.");
  await form.getByLabel("Name to show").fill("Ada B.");
  await shot(buyer, "68-buyer-review");
  await form.getByRole("button", { name: "Send review" }).click();
  await expect(buyer.getByText(/you gave it 4 of 5 stars\. It shows on the store once the shop has had a look\./)).toBeVisible();

  // Using the code again with the same email is refused.
  await buyer.goto(lamp.store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByLabel("Discount code").fill("WELCOME10");
  await buyer.getByRole("button", { name: "Apply" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await fillAddress(buyer, "ada@example.com", "Ada Buyer");
  await expect(buyer.getByText("You've already used WELCOME10.")).toBeVisible();

  // The merchant publishes the review with a reply; it shows on the product page.
  await page.getByRole("link", { name: /Reviews/ }).first().click();
  const review = page.getByRole("listitem", { name: "Review by Ada B." });
  await expect(review).toContainText("Lovely warm light");
  await review.getByRole("button", { name: "Reply" }).click();
  await review.getByLabel("Public reply").fill("Thanks Ada! The large size is 20% bigger.");
  await review.getByRole("button", { name: "Save reply" }).click();
  await expect(review).toContainText("Your reply: Thanks Ada!");
  await shot(page, "69-admin-reviews");
  await review.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Nothing waiting.")).toBeVisible();
  await buyer.goto(lamp.store);
  await expect(buyer.getByRole("img", { name: "4 out of 5 stars" }).first()).toBeVisible();
  await expect(buyer.getByText("Thanks Ada! The large size is 20% bigger.")).toBeVisible();
  const ld = await buyer.locator('script[type="application/ld+json"]').first().textContent();
  expect(JSON.parse(ld!).aggregateRating).toMatchObject({ ratingValue: 4, reviewCount: 1 });
  await shot(buyer, "70-product-reviews");

  // Someone else leaves at payment. A reminder goes out, and when they pay it counts as won back.
  const grace = await (await browser.newContext({ ...info.project.use })).newPage();
  await grace.goto(lamp.store);
  await grace.getByRole("button", { name: "Add to cart" }).click();
  await grace.getByRole("link", { name: "Check out" }).click();
  await fillAddress(grace, "grace@example.com", "Grace Hopper");
  await expect(grace.getByRole("button", { name: /^Pay/ })).toBeVisible();
  const payUrl = grace.url();
  await grace.close();

  await page.getByRole("link", { name: "Marketing" }).first().click();
  await page.getByRole("button", { name: "Send reminders now" }).click();
  const stats = page.getByRole("region", { name: "Checkout reminders" });
  await expect(stats.getByText("Sent, last 30 days").locator("..")).toContainText("1");
  const back = await (await browser.newContext({ ...info.project.use })).newPage();
  await back.goto(payUrl);
  await back.getByRole("button", { name: /^Pay/ }).click();
  await expect(back.getByRole("heading", { name: "Thank you, Grace!" })).toBeVisible();
  await page.reload();
  await expect(stats.getByText("Then paid").locator("..")).toContainText("1");
  await shot(page, "71-marketing-reminders");
});
