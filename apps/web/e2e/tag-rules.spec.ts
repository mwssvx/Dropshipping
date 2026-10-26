import { expect, test, type Page } from "@playwright/test";

// Tag rules: the merchant adds a rule on the Customers page, a buyer who matches is tagged when
// their order is paid, and removing the rule takes the tag off.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a rule tags a buyer when their order is paid, and removing it takes the tag off", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`tr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Tagged ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Tagged/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/customers");
  const rules = page.getByRole("region", { name: "Tag customers automatically" });
  await rules.getByLabel("Customers who").selectOption("bought");
  await rules.getByLabel("Which product").selectOption({ label: "Sunset Projection Lamp" });
  await rules.getByLabel("Get the tag").fill("lamp, owner");
  await rules.getByRole("button", { name: "Add rule" }).click();
  await expect(rules.getByText("A rule gives one tag. Leave out the comma.")).toBeVisible();
  // What was picked stays after the error.
  await expect(rules.getByLabel("Which product")).toHaveValue(/.+/);
  await rules.getByLabel("Get the tag").fill("Lamp owner");
  await rules.getByRole("button", { name: "Add rule" }).click();
  await expect(rules.getByText("Added. Nobody matches it yet.")).toBeVisible();
  const rule = rules.getByRole("listitem", { name: "Rule for lamp owner" });
  await expect(rule).toContainText("Bought Sunset Projection Lamp");
  await expect(rule).toContainText("0 customers");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`tr-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // Tagged as soon as the order is paid (the follow-up work runs just after the payment).
  await expect(async () => {
    await page.goto("/admin/customers");
    await expect(rule).toContainText("1 customer", { timeout: 1000 });
  }).toPass();
  await expect(page.getByLabel("Filter by tag").getByRole("link", { name: /^lamp owner/ })).toBeVisible();
  await shot(page, "430-tag-rules");
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  await expect(page.getByLabel("Tags", { exact: true })).toHaveValue("lamp owner");
  await expect(page.getByText("From a tag rule: lamp owner.")).toBeVisible();

  await page.getByRole("link", { name: "← Customers" }).click();
  await rule.getByRole("button", { name: "Remove the rule for lamp owner" }).click();
  await expect(rule).toHaveCount(0);
  await expect(page.getByLabel("Filter by tag")).toHaveCount(0);
});
