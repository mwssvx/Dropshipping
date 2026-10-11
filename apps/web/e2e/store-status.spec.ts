import { expect, test, type Page } from "@playwright/test";

// Store status: before launch the store can hide behind a password page that collects emails,
// and on a holiday break buyers can look around but not check out.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a password page before launch, then a holiday break", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`closed-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Closed ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Closed/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const home = product.replace(/\/products\/.*$/, "");

  // Behind a password, with a message.
  await page.goto("/admin/store-status");
  await page.getByRole("radio", { name: /^Behind a password/ }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Choose a password to give the people who may see the store.")).toBeVisible();
  await page.getByLabel("Store password").fill("glow-preview");
  await page.getByLabel("Message for buyers").fill("Lamps that glow, from November.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Your store is behind the password page.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: /Your store is behind a password/ })).toBeVisible();
  await shot(page, "361-store-status-admin");

  // A visitor lands on a product and gets the Opening soon page instead.
  const visitor = await (await browser.newContext({ ...info.project.use })).newPage();
  await visitor.goto(product);
  await expect(visitor).toHaveURL(/\/password$/);
  await expect(visitor.getByRole("heading", { name: "Opening soon" })).toBeVisible();
  await expect(visitor.getByText("Lamps that glow, from November.")).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Add to cart" })).toHaveCount(0);
  await shot(visitor, "362-store-password-page");
  // Search engines are kept out.
  const robots = await (await visitor.request.get(`${home}/robots.txt`)).text();
  expect(robots).toContain(`Disallow: ${home}\n`);
  // Leaving an email joins the store's list.
  await visitor.getByRole("textbox", { name: "Email for news and offers" }).fill(`fan-${id}@example.com`);
  await visitor.getByRole("button", { name: "Sign up" }).click();
  await expect(visitor.getByText("Check your inbox: click the link we sent to confirm.")).toBeVisible();
  // A wrong password, then the right one.
  await visitor.getByText("Have the password?").click();
  await visitor.getByLabel("Store password").fill("nope");
  await visitor.getByRole("button", { name: "Enter" }).click();
  await expect(visitor.getByText("That password isn't right.")).toBeVisible();
  await visitor.getByLabel("Store password").fill("glow-preview");
  await visitor.getByRole("button", { name: "Enter" }).click();
  await expect(visitor).toHaveURL(new RegExp(`${home}$`));
  await visitor.goto(product);
  await expect(visitor.getByRole("button", { name: "Add to cart" })).toBeVisible();

  // On a break: anyone can look around, nobody can check out.
  await page.goto("/admin/store-status");
  await page.getByRole("radio", { name: /^On a break/ }).check();
  await page.getByLabel("Message for buyers").fill("Back from the trade fair soon.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Your store is on a break.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await expect(buyer.getByText("We're taking a short break.")).toBeVisible();
  await expect(buyer.getByText("Back from the trade fair soon.")).toBeVisible();
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer).toHaveURL(/\/cart$/);
  await expect(buyer.getByText("Checkout opens again when we're back.")).toBeVisible();
  await expect(buyer.getByRole("link", { name: "Check out" })).toHaveCount(0);
  await shot(buyer, "363-store-holiday-cart");
  await buyer.goto(`${home}/checkout`);
  await expect(buyer).toHaveURL(/\/cart$/);

  // Open again.
  await page.getByRole("radio", { name: /^Open/ }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Your store is open.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByRole("link", { name: "Check out" })).toBeVisible();
  await expect(buyer.getByText("We're taking a short break.")).toHaveCount(0);
});
