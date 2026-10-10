import { expect, test } from "@playwright/test";

// "Track your order": a buyer without an account gets their order's link by email from the
// store footer. The page says the same thing whether or not the order exists.

test("a buyer without an account gets their order link by email", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`trk-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Where ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Where/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const email = `ada-${id}@example.com`;
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const orderUrl = new URL(buyer.url()).pathname;

  // Later, on another device, from the footer.
  const later = await (await browser.newContext({ ...info.project.use })).newPage();
  await later.goto(lamp);
  await later.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Track your order" }).click();
  await expect(later.getByRole("heading", { name: "Track your order" })).toBeVisible();
  await later.getByLabel("Order number").fill("abc");
  await later.getByLabel("Email").fill(email);
  await later.getByRole("button", { name: "Email me the link" }).click();
  await expect(later.getByRole("alert").filter({ hasText: "order number from your confirmation" })).toBeVisible();
  // A number that isn't theirs gets the same answer as one that is.
  await later.getByLabel("Email").fill(email);
  await later.getByLabel("Order number").fill("1999");
  await later.getByRole("button", { name: "Email me the link" }).click();
  await expect(later.getByRole("status")).toContainText("If we have an order with that number and email");
  await later.getByLabel("Email").fill(email);
  await later.getByLabel("Order number").fill("#1001");
  await later.getByRole("button", { name: "Email me the link" }).click();
  await expect(later.getByRole("status")).toContainText("If we have an order with that number and email");

  const inbox = await later.context().newPage();
  await inbox.goto("/dev/mail");
  const mail = inbox.getByRole("article").filter({ hasText: email }).filter({ hasText: "Your order #1001 from" });
  await expect(mail).toHaveCount(1);
  const link = (await mail.textContent())!.match(/https?:\/\/\S+?\/orders\/[\w-]+/)![0];
  expect(new URL(link).pathname).toBe(orderUrl.replace(/^\/s\/[^/]+/, ""));
  await later.goto(link);
  await expect(later.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // The merchant sees it in the order's email list.
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await expect(page.getByText(/Order link \(Track your order\) email sent/)).toBeVisible();
});
