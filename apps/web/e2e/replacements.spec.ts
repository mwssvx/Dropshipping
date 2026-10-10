import { expect, test, type Page } from "@playwright/test";

// Replacements: a package never arrived, so the buyer says so from their order page and the
// merchant sends a free replacement. It goes to the supplier as its own order, linked both ways.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a lost package is replaced for free", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Again ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Again/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`rp-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const orderPage = buyer.url();

  // Before it ships there's nothing to replace.
  await page.goto("/admin/orders");
  const first = (await page.getByRole("link", { name: "#1001" }).first().getAttribute("href"))!;
  await page.goto(first);
  await expect(page.getByText("Send a replacement")).toHaveCount(0);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Check for tracking now" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Check for tracking now" }).click();
  await expect(page.getByText(/Shipped with Demo Post/).first()).toBeVisible();

  // The buyer says it never arrived.
  await buyer.goto(orderPage);
  await buyer.getByText("Return something").click();
  await buyer.getByLabel("Why?").selectOption({ label: "It never arrived" });
  await buyer.getByRole("button", { name: "Ask for a return" }).click();
  await expect(buyer.locator("#returns")).toContainText("you asked for a return");

  // The merchant answers with a replacement.
  await page.goto("/admin/returns");
  const request = page.getByRole("listitem", { name: "Return for order #1001" });
  await expect(request).toContainText("It never arrived");
  await request.getByLabel("Message to the buyer").fill("Sorry about that. A new one is on its way.");
  await request.getByRole("button", { name: "Send a replacement" }).click();
  const answered = page.getByRole("listitem", { name: "Answered return for order #1001" });
  await expect(answered).toContainText("Replacement sent");
  await answered.getByRole("link", { name: "Replacement" }).click();
  await expect(page.getByRole("heading", { name: "Order #1002" })).toBeVisible();
  await expect(page.getByText("Replacement", { exact: true })).toBeVisible();
  await expect(page.getByText("A free replacement for order #1001.")).toBeVisible();
  await expect(page.getByText("Sent to Demo supplier")).toBeVisible();
  await shot(page, "290-replacement-admin");

  // The buyer sees it on the first order, and follows it.
  await buyer.reload();
  await expect(buyer.locator("#returns")).toContainText("is sending a replacement. There's nothing to send back.");
  await buyer.getByRole("link", { name: "Track it" }).click();
  await expect(buyer.getByRole("heading", { name: "Your replacement" })).toBeVisible();
  await expect(buyer.getByText("A free replacement for order #1001.")).toBeVisible();
  await expect(buyer.getByText("Sorry about that. A new one is on its way.")).toBeVisible();
  await expect(buyer.getByRole("link", { name: /Invoice/ })).toHaveCount(0);
  await shot(buyer, "291-replacement-buyer");

  // The merchant can also send one straight from an order, for part of it.
  await page.goto(first);
  await expect(page.getByText("Replacement sent: order #1002.")).toBeVisible();
  await page.getByText("Send a replacement").click();
  await page.getByRole("textbox", { name: /Sunset Projection Lamp/ }).fill("0");
  await page.getByRole("button", { name: "Send replacement" }).click();
  await expect(page.getByText("Pick at least one item to send again.")).toBeVisible();
  await page.getByRole("textbox", { name: /Sunset Projection Lamp/ }).fill("1");
  await page.getByRole("button", { name: "Send replacement" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Replacement sent as order #1003." })).toBeVisible();
});
