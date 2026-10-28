import { expect, test, type Page } from "@playwright/test";

// The store review: the business analyst reads the store's numbers and leaves a few suggestions,
// each linking to where in the admin to act on it.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
};

test("the business analyst reviews the store and suggests what to do next", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`insights-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Review ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Review/ })).toBeVisible();

  await page.goto("/admin/insights");
  await expect(page.getByRole("heading", { name: "Store review" })).toBeVisible();
  await page.getByRole("button", { name: "Review my store" }).click();
  // A brand-new store has no sales, so the first suggestion is about getting found.
  await expect(page.getByRole("heading", { name: "1. Get your first visitors" })).toBeVisible();
  await expect(page.getByText(/has no orders in the last 30 days yet/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Email campaigns" })).toHaveAttribute("href", "/admin/campaigns");
  await shot(page, "145-store-review");

  // Asking again straight away is refused: the numbers won't have changed.
  await page.getByRole("button", { name: "Review again" }).click();
  await expect(page.getByText(/in the last 12 hours/)).toBeVisible();

  // It can run by itself every Monday.
  await page.goto("/admin/ai");
  // Its look-ups show in the activity log, under its name.
  await expect(page.getByRole("cell", { name: "Business analyst" }).first()).toBeVisible();
  await page.getByLabel("Review my store every Monday").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/admin/insights");
  await expect(page.getByText("It also runs every Monday.")).toBeVisible();
});

test("the trend scout suggests products to add, once a day", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`trends-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Trends ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Trends/ })).toBeVisible();

  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const home = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");

  // A shopper searched for something the store doesn't sell.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${home}/search?q=cat+bed`);
  await expect(buyer.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto("/admin/insights");
  await page.getByLabel("What kind of products? (optional)").fill("pet gifts");
  await page.getByRole("button", { name: "Find trending products" }).click();
  // Demo mode says so, and the shopper's unmet search comes first.
  await expect(page.getByText(/^Demo mode/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cat bed" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Find “cat bed” on AliExpress ↗" })).toHaveAttribute("href", /SearchText=cat%20bed/);
  await shot(page, "146-trending-products");

  await page.getByRole("button", { name: "Find trending products" }).click();
  await expect(page.getByText(/try again tomorrow/)).toBeVisible();
});

test("the assistant uses its skills: trend research starts the trend scout, and skills can be switched off", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`skills-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Skills ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Skills/ })).toBeVisible();

  await page.goto("/admin/assistant");
  await page.getByRole("button", { name: "What's trending that I could sell?" }).click();
  await expect(page.getByText(/The full list, with sources, is on the Insights page/)).toBeVisible();
  await shot(page, "147-assistant-skills");
  // The ideas it found are saved where the trend scout keeps them.
  await page.goto("/admin/insights");
  await expect(page.getByText(/^Demo mode/)).toBeVisible();

  await page.goto("/admin/ai");
  await expect(page.getByRole("cell", { name: "Trend scout" }).first()).toBeVisible();
  await page.getByLabel(/^Marketing/).uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/^Marketing/)).not.toBeChecked();
  await expect(page.getByLabel(/^Data analyst/)).toBeChecked();
});
