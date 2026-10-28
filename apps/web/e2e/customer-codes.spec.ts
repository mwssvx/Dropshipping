import { expect, test, type Page } from "@playwright/test";

// Codes for tagged customers: VIP10 works only for buyers the merchant tagged "vip".

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a code for tagged customers turns others away at checkout", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Club ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Club/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const [store] = lamp.split("/products/");

  const shopper = async (email: string, name: string) => {
    const p = await (await browser.newContext({ ...info.project.use })).newPage();
    const checkout = async () => {
      await p.getByRole("link", { name: "Check out" }).click();
      await p.getByRole("textbox", { name: "Email" }).fill(email);
      await p.getByLabel("Full name").fill(name);
      await p.getByLabel("Address", { exact: true }).fill("1 Main St");
      await p.getByLabel("City").fill("Austin");
      await p.getByLabel("State or region").fill("TX");
      await p.getByLabel("Postal code").fill("78701");
      await p.getByRole("button", { name: "Continue to payment" }).click();
    };
    return { page: p, checkout };
  };

  // Ada orders once, so she's a customer, and the merchant tags her.
  const ada = await shopper(`ada-${id}@example.com`, "Ada Lovelace");
  await ada.page.goto(lamp);
  await ada.page.getByRole("button", { name: "Add to cart" }).click();
  await ada.checkout();
  await ada.page.getByRole("button", { name: /^Pay/ }).click();
  await expect(ada.page.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await page.goto("/admin/customers");
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  await page.getByLabel("Tags", { exact: true }).fill("VIP");
  await page.getByRole("button", { name: "Save note and tags" }).click();
  await expect(page.getByLabel("Tags", { exact: true })).toHaveValue("vip");

  // The code, for customers tagged vip.
  await page.goto("/admin/marketing");
  await page.getByLabel("Code", { exact: true }).fill("vip10");
  await page.getByLabel("Percent").fill("10");
  await page.getByLabel("Only for customers tagged").fill("vip");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("Code created. Buyers can use it now.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "VIP10" })).toContainText("customers tagged “vip”");
  await shot(page, "413-customer-code");

  // Someone else tries it: fine in the cart, turned away at checkout without naming the tag.
  const grace = await shopper(`grace-${id}@example.com`, "Grace Hopper");
  await grace.page.goto(`${store}/discount/VIP10?to=/products/${lamp.split("/products/")[1]}`);
  await grace.page.getByRole("button", { name: "Add to cart" }).click();
  await expect(grace.page.getByText("Discount (VIP10)")).toBeVisible();
  await grace.checkout();
  await expect(grace.page.getByText("VIP10 is for some customers only. Check out with the email on your account to use it.")).toBeVisible();
  await expect(grace.page.getByText(/vip/)).toHaveCount(0);

  // Ada gets it.
  await ada.page.goto(`${store}/discount/VIP10?to=/products/${lamp.split("/products/")[1]}`);
  await ada.page.getByRole("button", { name: "Add to cart" }).click();
  await expect(ada.page.getByText("Discount (VIP10)")).toBeVisible();
  await ada.checkout();
  await ada.page.getByRole("button", { name: /^Pay/ }).click();
  await expect(ada.page.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
});
