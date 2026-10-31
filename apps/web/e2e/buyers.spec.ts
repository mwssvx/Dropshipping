import { expect, test, type Page } from "@playwright/test";

// Buyer accounts: a shopper signs in with an emailed code, sees their orders, buys again and checks
// out with their details filled in. The merchant sees them on the Customers page.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchantWithLamp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`buyers-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lumen ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lumen/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
}

async function buy(page: Page, productUrl: string, email: string) {
  await page.goto(productUrl);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "Check out" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill("Ada Buyer");
  await page.getByLabel("Address", { exact: true }).fill("1 Main St");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("State or region").fill("TX");
  await page.getByLabel("Postal code").fill("78701");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /^Pay/ }).click();
  await expect(page.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
}

test("a shopper signs in with a code, sees their order, buys again and checks out faster", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const product = await newMerchantWithLamp(page, id);
  const email = `ada-${id}@example.com`;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buy(buyer, product, email);
  await buyer.getByRole("link", { name: "See all your orders" }).click();

  await expect(buyer.getByRole("heading", { name: "Your orders" })).toBeVisible();
  await buyer.getByLabel("Email").fill(email);
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  await expect(buyer.getByRole("status")).toContainText(`We sent a 6-digit code to ${email}`);

  // The development outbox, in another tab, stands in for the shopper's inbox.
  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const subject = await inbox.getByRole("article").filter({ hasText: email }).first().getByRole("heading").textContent();
  const code = subject!.match(/^(\d{6}) is your Lumen/)![1]!;
  await inbox.close();

  await buyer.getByLabel("Code").fill(code === "000000" ? "111111" : "000000");
  await buyer.getByRole("button", { name: "Sign in" }).click();
  await expect(buyer.getByText("That code isn't right. 4 tries left.")).toBeVisible();
  await buyer.getByLabel("Code").fill(code);
  await shot(buyer, "87-buyer-code");
  await buyer.getByRole("button", { name: "Sign in" }).click();

  await expect(buyer.getByText(`Signed in as ${email}`)).toBeVisible();
  const order = buyer.getByRole("listitem", { name: /Order #\d+/ });
  await expect(order).toHaveCount(1);
  await expect(order).toContainText("Sunset Projection Lamp");
  await shot(buyer, "88-buyer-orders");

  await order.getByRole("button", { name: /Buy order #\d+ again/ }).click();
  await expect(buyer.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect(buyer.getByText(/Sunset Projection Lamp/).first()).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByLabel("Email")).toHaveValue(email);
  await expect(buyer.getByLabel("Full name")).toHaveValue("Ada Buyer");
  await expect(buyer.getByLabel("Postal code")).toHaveValue("78701");
  // One address so far, so there's nothing to pick from.
  await expect(buyer.getByLabel("Your addresses")).toHaveCount(0);

  // This one goes to work, and the next checkout offers both places.
  await buyer.getByLabel("Address", { exact: true }).fill("500 Congress Ave");
  await buyer.getByLabel("Apartment, suite (optional)").fill("Floor 3");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await buyer.goto(product);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  const saved = buyer.getByLabel("Your addresses");
  await expect(saved.locator("option")).toHaveText(["Ada Buyer, 500 Congress Ave, Floor 3, Austin 78701", "Ada Buyer, 1 Main St, Austin 78701", "A new address"]);
  await expect(buyer.getByLabel("Address", { exact: true })).toHaveValue("500 Congress Ave");
  await saved.selectOption({ label: "Ada Buyer, 1 Main St, Austin 78701" });
  await expect(buyer.getByLabel("Address", { exact: true })).toHaveValue("1 Main St");
  await expect(buyer.getByLabel("Apartment, suite (optional)")).toHaveValue("");
  await expect(buyer.getByLabel("Postal code")).toHaveValue("78701");
  await saved.selectOption({ label: "A new address" });
  await expect(buyer.getByLabel("Full name")).toHaveValue("");
  await expect(buyer.getByLabel("Address", { exact: true })).toHaveValue("");

  // The merchant sees Ada as a customer with an account.
  await page.getByRole("link", { name: "Customers" }).first().click();
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("Ada Buyer");
  await expect(row).toContainText("Signed in");
  await shot(page, "89-customers");
});
