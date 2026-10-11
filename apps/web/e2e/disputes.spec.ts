import { expect, test, type Page } from "@playwright/test";

// Disputes: when a buyer's bank pulls a payment back, the merchant sees it on the order with the
// evidence we gathered, sends it with a note, or accepts it. Test mode simulates the bank.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("merchants answer a dispute with the evidence we gathered", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`dp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lamps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lamps/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // No disputes yet.
  await page.goto("/admin/disputes");
  await expect(page.getByText("No disputes. That's how it should be.")).toBeVisible();

  // The bank opens one.
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/[^/]+$/);
  const simulate = page.getByText("Test mode: simulate a dispute");
  await expect(async () => {
    await page.reload();
    await expect(simulate).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await simulate.click();
  await page.getByRole("button", { name: "Simulate a dispute" }).click();

  const dispute = page.getByRole("region", { name: /^Disputed: \$/ });
  await expect(dispute.getByText("Needs your answer")).toBeVisible();
  await expect(dispute).toContainText("The money is held until the bank decides.");
  const evidence = dispute.getByRole("list", { name: "Evidence" });
  await expect(evidence.getByRole("listitem")).toHaveCount(4);
  await expect(evidence.getByRole("listitem").filter({ hasText: "Returns policy" })).toContainText("(missing)");
  await dispute.getByText("See everything we'll send").click();
  await expect(dispute.getByText(/Order #1001 from Lamps/)).toBeVisible();
  if (info.project.name === "desktop") await expect(page.getByRole("link", { name: /^Disputes\s*1$/ })).toBeVisible();
  await shot(page, "291-dispute");

  // The merchant adds a note and sends it.
  await dispute.getByLabel("Anything to add (optional)").fill("The buyer emailed to say thanks.");
  await dispute.getByRole("button", { name: "Send evidence" }).click();
  await expect(dispute.getByText("Bank reviewing")).toBeVisible();
  await expect(dispute.getByText(/^Evidence sent on .* The bank is reviewing it/)).toBeVisible();
  await expect(dispute.getByText("Your note: The buyer emailed to say thanks.")).toBeVisible();

  // The bank decides in the merchant's favour.
  await dispute.getByRole("button", { name: "Won", exact: true }).click();
  await expect(dispute.getByText("You won. The money is back in your balance.")).toBeVisible();

  // A second one: the merchant gives it up.
  await simulate.click();
  await page.getByLabel("Reason").selectOption("fraudulent");
  await page.getByRole("button", { name: "Simulate a dispute" }).click();
  await expect(dispute.getByText("Needs your answer")).toBeVisible();
  await dispute.getByRole("button", { name: "Accept dispute" }).click();
  await dispute.getByRole("button", { name: "Yes, accept dispute" }).click();
  await expect(dispute.getByText(/^The buyer kept the money\./)).toBeVisible();

  // Both on the disputes page, with the rate.
  await page.goto("/admin/disputes");
  const summary = page.getByRole("definition").filter({ hasText: "·" });
  await expect(summary).toHaveText("1 · 1");
  const list = page.getByRole("list", { name: "Disputes" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").filter({ hasText: "Lost" })).toContainText("didn't make this payment");
  await expect(list.getByRole("listitem").filter({ hasText: "Won" })).toContainText(`ada-${id}@example.com`);
  await expect(page.getByText(/disputes on 1 orders in 90 days is above 0.75%/)).toBeVisible();
  await shot(page, "292-disputes-page");
  await list.getByRole("link", { name: "Order #1001" }).first().click();
  await expect(page).toHaveURL(/\/admin\/orders\/.+#dispute$/);
});
