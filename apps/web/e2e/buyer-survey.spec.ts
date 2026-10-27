import { expect, test } from "@playwright/test";

// Buyer survey: the store asks "How did you hear about us?" after paying, the buyer answers on
// their order page, and the answer shows on the order and in the survey report.

test("a buyer says how they heard about the store", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sv-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Asked ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Asked/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Linen Towel");
  await page.getByLabel("Price", { exact: true }).fill("15.00");
  await page.getByLabel("Stock", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/survey");
  await page.getByLabel("Answers to pick from, one per line").fill("Instagram\nA friend\nA podcast");
  await page.getByRole("button", { name: "Start asking" }).click();
  await expect(page.getByText("Saved. Buyers see it on their order page after paying.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  const question = buyer.getByRole("region", { name: "How did you hear about us?" });
  await question.getByRole("radio", { name: "Other" }).check();
  await question.getByLabel("Tell us where").fill("A newsletter");
  await question.getByRole("button", { name: "Send answer" }).click();
  await expect(buyer.getByText("Thanks for telling us.")).toBeVisible();
  await expect(buyer.getByRole("region", { name: "How did you hear about us?" })).toHaveCount(0);

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await expect(page.getByText("(A newsletter)")).toBeVisible();
  await page.getByRole("link", { name: "Other", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Buyer survey" })).toBeVisible();
  await expect(page.getByText("1 of 1 order answered (100%).")).toBeVisible();
  await expect(page.getByRole("row", { name: /Other 1 100%/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "In their own words" }).getByText("A newsletter")).toBeVisible();
});
