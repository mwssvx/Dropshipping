import { expect, test } from "@playwright/test";

// Product quiz: the merchant writes two questions whose answers lead to product tags, and a
// shopper's answers bring up the products that fit best.

test("a shopper answers the store's quiz and gets the products that fit", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`quiz-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Quiz ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Quiz/ })).toBeVisible();

  let store = "";
  for (const [title, tags] of [["Straw Sun Hat", "summer, adults"], ["Kids Sun Hat", "summer, kids"], ["Wool Scarf", "winter, adults"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill("20.00");
    await page.getByLabel("Tags", { exact: true }).fill(tags);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
    store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");
  }

  await page.goto("/admin/marketing");
  await page.getByRole("link", { name: "Make a quiz" }).click();
  await page.getByLabel("Quiz title").fill("Find your hat");
  await page.getByLabel("Question 1", { exact: true }).fill("When will you wear it?");
  await page.getByLabel("Question 1, answer 1", { exact: true }).fill("In the sun");
  await page.getByLabel("Question 1, answer 1, product tag").fill("summer");
  await page.getByLabel("Question 1, answer 2", { exact: true }).fill("In the cold");
  await page.getByLabel("Question 1, answer 2, product tag").fill("snow");
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.getByLabel("Question 2", { exact: true }).fill("Who's it for?");
  await page.getByLabel("Question 2, answer 1", { exact: true }).fill("Me");
  await page.getByLabel("Question 2, answer 1, product tag").fill("adults");
  await page.getByLabel("Question 2, answer 2", { exact: true }).fill("My kids");
  await page.getByLabel("Question 2, answer 2, product tag").fill("kids");
  await page.getByRole("button", { name: "Save the quiz" }).click();
  // Every answer has to lead somewhere.
  await expect(page.locator(".banner-critical")).toHaveText('No product is tagged "snow" yet. Tag some products first, or pick a tag you use.');
  await page.getByLabel("Question 1, answer 2, product tag").fill("winter");
  await page.getByRole("button", { name: "Save the quiz" }).click();
  await expect(page.locator(".banner-success")).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByLabel("Link to share")).toHaveValue(/\/quiz$/);

  const shopper = await (await browser.newContext({ ...info.project.use })).newPage();
  await shopper.goto(`${store}/quiz`);
  await expect(shopper.getByRole("heading", { name: "Find your hat" })).toBeVisible();
  await shopper.getByRole("group", { name: "When will you wear it?" }).getByText("In the sun").click();
  await shopper.getByRole("group", { name: "Who's it for?" }).getByText("My kids").click();
  await shopper.getByRole("button", { name: "See my picks" }).click();
  const picks = shopper.getByRole("region", { name: "Your picks" });
  // Both answers first, then one; the scarf matches neither.
  await expect(picks.getByRole("link", { name: /Sun Hat/ }).first()).toHaveText(/Kids Sun Hat/);
  await expect(picks.getByText("Straw Sun Hat").first()).toBeVisible();
  await expect(picks.getByText("Wool Scarf")).toHaveCount(0);
  await expect(shopper.getByRole("radio", { name: "My kids" })).toBeChecked();
});
