import { expect, test, type Page } from "@playwright/test";

// Often bought together: once buyers have bought two products in the same order a couple of
// times, each product's page suggests the other.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("products bought together are suggested on each other's page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bt-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Pairs ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Pairs/ })).toBeVisible();
  const links: string[] = [];
  for (const name of [/sunset projection lamp/i, /galaxy projector low stock/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    links.push((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
  }
  const [lamp, projector] = links as [string, string];

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await expect(buyer.getByRole("heading", { name: "Often bought together" })).toHaveCount(0);

  // Two buyers take both.
  for (const n of [1, 2]) {
    for (const url of [lamp, projector]) {
      await buyer.goto(url);
      await buyer.getByRole("button", { name: "Add to cart" }).click();
      await expect(buyer.getByRole("heading", { name: "Your cart" })).toBeVisible();
    }
    await buyer.getByRole("link", { name: "Check out" }).click();
    await buyer.getByRole("textbox", { name: "Email" }).first().fill(`buyer${n}-${id}@example.com`);
    await buyer.getByLabel("Full name").fill("Ada Lovelace");
    await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
    await buyer.getByLabel("City").fill("Austin");
    await buyer.getByLabel("State or region").fill("TX");
    await buyer.getByLabel("Postal code").fill("78701");
    await buyer.getByRole("button", { name: "Continue to payment" }).click();
    await buyer.getByRole("button", { name: /^Pay / }).click();
    await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  }

  await buyer.goto(lamp);
  const section = buyer.getByRole("region", { name: "Often bought together" });
  await expect(section.getByRole("link", { name: /Galaxy Projector/i })).toBeVisible();
  await shot(buyer, "351-bought-together");
  await buyer.goto(projector);
  await expect(buyer.getByRole("region", { name: "Often bought together" }).getByRole("link", { name: /Sunset Projection Lamp/i })).toBeVisible();

  // In the cart with just the lamp, the projector is offered.
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("region", { name: "Goes well with" }).getByRole("link", { name: /Galaxy Projector/i })).toBeVisible();
});
