import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// A signed-in buyer's account lists what they can review, and each link goes to the order's form.
// A ?rate= link (from the review request email) picks the stars.

test("the buyer's account lists products waiting for a review", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const email = `rev-${id}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ar-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Account ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Account/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const storeRoot = store.split("/products/")[0]!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill(email);
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // Sign in on the store account.
  await buyer.goto(`${storeRoot}/account`);
  await buyer.getByLabel("Email", { exact: true }).fill(email);
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const subject = await inbox.getByRole("article").filter({ hasText: email }).filter({ has: inbox.getByRole("heading", { name: /^\d{6}/ }) }).first().getByRole("heading").textContent();
  await inbox.close();
  await buyer.getByLabel("Code").fill(subject!.match(/^(\d{6})/)![1]!);
  await buyer.getByRole("button", { name: "Sign in" }).click();
  await expect(buyer.getByRole("listitem", { name: "Order #1001" })).toBeVisible();
  // Nothing to review until it ships.
  const section = buyer.getByRole("region", { name: "Waiting for your review" });
  await expect(section).toHaveCount(0);

  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Check for tracking now" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Check for tracking now" }).click();
  await expect(page.getByText(/Shipped with Demo Post/).first()).toBeVisible();

  await buyer.reload();
  await expect(section).toContainText("Sunset Projection Lamp");
  await expect(section).toContainText("order #1001");
  const result = await new AxeBuilder({ page: buyer }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await section.getByRole("link", { name: "Review Sunset Projection Lamp" }).click();
  await expect(buyer).toHaveURL(/\/orders\/[^/#]+#review$/);
  const form = buyer.getByRole("form", { name: "Review Sunset Projection Lamp" });
  await expect(form.getByLabel("5 stars")).not.toBeChecked();
  // The review request email's star links open the form with that rating picked.
  const orderUrl = new URL(buyer.url());
  orderUrl.searchParams.set("rate", "4");
  await buyer.goto(orderUrl.toString());
  await expect(form.getByLabel("4 stars")).toBeChecked();
  await expect(form.getByLabel("Your review")).toBeFocused();
  await buyer.keyboard.type("Fills the whole ceiling with colour.");
  await form.getByLabel("Name to show").fill("Ada B.");
  await form.getByRole("button", { name: "Send review" }).click();
  await expect(buyer.getByText(/you gave it 4 of 5 stars/)).toBeVisible();

  await buyer.goto(`${storeRoot}/account`);
  await expect(buyer.getByRole("listitem", { name: "Order #1001" })).toBeVisible();
  await expect(section).toHaveCount(0);
});
