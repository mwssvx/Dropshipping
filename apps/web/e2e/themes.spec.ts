import { expect, test, type Page } from "@playwright/test";

// Ready-made themes: the merchant switches the whole store's look and layout in one click, and the
// email signup section adds buyers to the campaign list once they confirm by email.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchantWithLamp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`thm-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Atelier ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Atelier/ })).toBeVisible();
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  }
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  return product.replace(/\/products\/.*$/, "");
}

async function useTheme(page: Page, name: string) {
  await page.goto("/admin/theme");
  await page.getByRole("tab", { name: "Themes" }).click();
  await page.getByLabel("Also replace my home page sections").check();
  await page.getByRole("button", { name: `Use ${name}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `${name} applied` })).toBeVisible();
  await expect(page.getByRole("listitem", { name: `${name} theme` }).getByText("Current")).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
}

async function publish(page: Page) {
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();
}

test("switching to a ready-made theme changes the layout, and the email signup needs a confirmation", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const store = await newMerchantWithLamp(page, id);
  await useTheme(page, "Boutique");
  await page.frameLocator('iframe[title="Store preview"]').getByRole("heading", { name: "Hear about new arrivals first" }).waitFor();
  await shot(page, "99-theme-gallery");
  await publish(page);

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  const shell = buyer.locator(".store");
  await expect(shell).toHaveAttribute("data-header", "centered");
  await expect(shell).toHaveAttribute("data-buttons", "outline");
  await expect(buyer.locator(".sf-media").first()).toHaveCSS("aspect-ratio", "3 / 4");
  await expect(buyer.getByRole("heading", { name: "Shop by category" })).toHaveCount(0); // no collections yet, so it hides
  await expect(buyer.getByRole("heading", { name: "New in" })).toBeVisible();
  await shot(buyer, "100-store-boutique");

  // The signup sends a confirm link; nobody is on the list until they click it.
  const email = `thm-fan-${id}@example.com`;
  await buyer.getByLabel("Email for news and offers").fill(email);
  await buyer.getByRole("button", { name: "Sign up" }).click();
  await expect(buyer.getByRole("status")).toContainText("Check your inbox");
  await page.goto("/admin/campaigns");
  await expect(page.getByText("Subscribers", { exact: true }).locator("..")).toContainText("0");

  const inbox = await page.context().newPage();
  await inbox.goto("/dev/mail");
  const mail = inbox.getByRole("article").filter({ hasText: email }).filter({ hasText: "Confirm your signup" });
  const link = (await mail.textContent())!.match(/https?:\/\/\S+?\/subscribe\/[0-9a-f]{64}/)![0];
  await inbox.close();
  await buyer.goto(link);
  await buyer.getByRole("button", { name: "Confirm" }).click();
  await expect(buyer.getByRole("heading", { name: "You're signed up" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Subscribers", { exact: true }).locator("..")).toContainText("1");

  // Layout options can be changed one by one after picking a theme.
  await page.goto("/admin/theme");
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByLabel("Header", { exact: true }).selectOption({ label: "Logo left, menu beside it" });
  await page.getByLabel("Products per row on computers").selectOption("4");
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await publish(page);
  await buyer.goto(store);
  await expect(shell).toHaveAttribute("data-header", "classic");
  await expect(shell).toHaveAttribute("data-cols", "4");
});

test("the Market theme shows trust badges and framed product cards", async ({ page, browser }, info) => {
  const id = `${info.project.name}-mk-${Date.now()}`;
  const store = await newMerchantWithLamp(page, id);
  await useTheme(page, "Market");
  await publish(page);
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.locator(".store")).toHaveAttribute("data-cards", "framed");
  await expect(buyer.getByText("Tracked delivery")).toBeVisible();
  await expect(buyer.getByRole("heading", { name: "Today's deals" })).toBeVisible();
  await shot(buyer, "101-store-market");
});
