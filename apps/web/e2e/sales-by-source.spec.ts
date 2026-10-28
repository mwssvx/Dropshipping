import { expect, test } from "@playwright/test";

// Sales by source: an order remembers where its visit came from (a site, or the link's
// utm_source), and Analytics adds up what each source sold. Its headline numbers compare with an earlier period.

test("a sale from a tagged Instagram link shows under Sales by source", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sbs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Sources ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Sources/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const seen = buyer.waitForResponse((r) => r.url().endsWith("/api/events"));
  await buyer.goto(`${lamp}?utm_source=instagram&utm_medium=social`);
  await seen;
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`sbs-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.goto("/admin/analytics");
  const bySource = page.getByRole("region", { name: "Sales by source" });
  await expect(bySource.getByRole("row", { name: /instagram/ })).toContainText("1");
  // The headline numbers say how they moved since the period before: this store had nothing then.
  const card = (name: string) => page.locator("dl > div").filter({ has: page.getByText(name, { exact: true }) });
  await expect(card("Sales")).toContainText("New vs the 30 days before");
  await expect(card("Orders")).toContainText("New vs the 30 days before");
  await page.getByRole("navigation", { name: "Compare with" }).getByRole("link", { name: "Same days last year" }).click();
  await expect(page).toHaveURL(/compare=year/);
  await expect(card("Sales")).toContainText("New vs the same days last year");
  await page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "7 days" }).click();
  await expect(page).toHaveURL(/days=7&compare=year/);
  await expect(page.getByRole("navigation", { name: "Compare with" }).getByRole("link", { name: "Same days last year" })).toHaveAttribute("aria-current", "page");
  // When buyers buy, in the store's time zone (New York for a US store), or one picked.
  const when = page.getByRole("region", { name: "When buyers buy" });
  const weekday = (timeZone: string) => new Date().toLocaleDateString("en-US", { weekday: "long", timeZone });
  await expect(when).toContainText("The busiest time shows once there are 10 orders in the period.");
  await expect(when.getByRole("listitem", { name: `${weekday("America/New_York")}: 1 order` })).toBeVisible();
  await when.getByLabel("Time zone").selectOption("Australia/Sydney");
  await when.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/days=7&compare=year&tz=Australia%2FSydney/);
  await expect(page.getByRole("region", { name: "When buyers buy" }).getByRole("listitem", { name: `${weekday("Australia/Sydney")}: 1 order` })).toBeVisible();
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByText("The buyer came from instagram.")).toBeVisible();
});
