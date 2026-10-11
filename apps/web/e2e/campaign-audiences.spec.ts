import { expect, test, type Page } from "@playwright/test";

// Campaign audiences: a campaign can go only to subscribers with one customer tag, or only to
// subscribers who bought one product.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function buy(page: Page, productUrl: string, email: string, name: string) {
  await page.goto(productUrl);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "Check out" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Send me news and offers").check();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Address", { exact: true }).fill("1 Main St");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("State or region").fill("TX");
  await page.getByLabel("Postal code").fill("78701");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /^Pay/ }).click();
  await expect(page.getByRole("heading", { name: `Thank you, ${name.split(" ")[0]}!` })).toBeVisible();
}

test("a campaign goes to subscribers with a tag, or who bought a product", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`aud-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Audience ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Audience/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  for (const [who, name] of [["ada", "Ada Lovelace"], ["grace", "Grace Hopper"]] as const) {
    const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
    await buy(buyer, product, `aud-${who}-${id}@example.com`, name);
  }

  // Ada is a VIP.
  await page.goto("/admin/customers");
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  await page.getByLabel("Tags", { exact: true }).fill("VIP");
  await page.getByRole("button", { name: "Save note and tags" }).click();
  await expect(page.getByLabel("Tags", { exact: true })).toHaveValue("vip");

  await page.goto("/admin/campaigns");
  await page.getByRole("textbox", { name: "Mailing address" }).fill("Lumen Goods\n12 Elm St\nAustin TX 78701");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("Address saved.")).toBeVisible();
  await page.getByRole("link", { name: "New campaign" }).click();
  await page.getByLabel("Subject").fill(`Early access ${id}`);
  await page.getByLabel("Email", { exact: true }).fill("Hi {first_name},\n\nOur new lamps are yours first.");
  await page.getByLabel("Send to").selectOption({ label: "Subscribers with a tag" });
  // Forgetting the tag is caught, and nothing typed is lost.
  await page.getByRole("button", { name: "Save and preview" }).click();
  await expect(page.getByText("Pick the tag to send to.")).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue(`Early access ${id}`);
  await page.getByLabel("Tag", { exact: true }).selectOption("vip");
  await page.getByRole("button", { name: "Save and preview" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await expect(page.getByText('To subscribers tagged "vip": 1.')).toBeVisible();
  await expect(page.getByRole("button", { name: "Send to 1 person" })).toBeVisible();
  await shot(page, "381-campaign-tag-audience");

  // Everyone who bought the lamp instead.
  await page.getByLabel("Send to").selectOption({ label: "Subscribers who bought a product" });
  await page.getByLabel("Product", { exact: true }).selectOption({ label: "Sunset Projection Lamp" });
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("To subscribers who bought Sunset Projection Lamp: 2.")).toBeVisible();
  await page.getByRole("button", { name: "Send to 2 people" }).click();
  await expect(page.getByRole("heading", { name: /^(Sent|Sending now)/ })).toBeVisible();
});
