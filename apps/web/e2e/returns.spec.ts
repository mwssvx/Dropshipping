import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

// Returns: the buyer asks from their order page, saying what and why. The merchant approves it,
// refunds it, gives store credit, or declines it, and the buyer sees each answer on the same page.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchantWithLamp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rt-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Backtrack ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Backtrack/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
}

/** Buys one lamp and returns the buyer's page, left on their order page. */
async function buyLamp(browser: Browser, info: TestInfo, lamp: string, email: string) {
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  return buyer;
}

async function askForReturn(buyer: Page, reason: string, note?: string) {
  await buyer.getByText("Return something").click();
  await buyer.getByLabel("Why?").selectOption({ label: reason });
  if (note) await buyer.getByLabel(/Anything the store should know/).fill(note);
  await buyer.getByRole("button", { name: "Ask for a return" }).click();
  await expect(buyer.locator("#returns")).toContainText("you asked for a return");
}

async function lastEmail(page: Page, email: string, subject: string) {
  const inbox = await page.context().newPage();
  await inbox.goto("/dev/mail");
  const text = await inbox.getByRole("article").filter({ hasText: email }).filter({ hasText: subject }).first().textContent();
  await inbox.close();
  return text!;
}

test("a buyer asks for a return, the merchant approves it, then refunds it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const lamp = await newMerchantWithLamp(page, id);
  await page.goto("/admin/returns");
  await page.getByLabel("What buyers do after you approve").fill("Send it to 9 Dock Rd, Austin TX 78701 and keep the receipt.");
  await page.getByRole("button", { name: "Save return settings" }).click();
  await expect(page.getByText("Return settings saved.")).toBeVisible();

  const email = `rt-buyer-${id}@example.com`;
  const buyer = await buyLamp(browser, info, lamp, email);
  await buyer.getByText("Return something").click();
  await buyer.getByRole("button", { name: "Ask for a return" }).click();
  expect(await buyer.getByLabel("Why?").evaluate((e) => (e as HTMLSelectElement).validity.valueMissing)).toBe(true);
  await shot(buyer, "109-buyer-return-form");
  await buyer.getByText("Return something").click(); // closes the details again
  await askForReturn(buyer, "It arrived damaged", "The glass is cracked.");
  await expect(buyer.getByText("Return something")).toHaveCount(0);

  // The merchant sees it in the nav and on the order.
  await page.goto("/admin/orders");
  await expect(page.getByRole("link", { name: /^Returns\s*1$/ })).toBeVisible();
  await page.goto((await page.getByRole("link", { name: "#1001" }).first().getAttribute("href"))!);
  await expect(page.getByText("The buyer asked to return items from this order.")).toBeVisible();
  await page.getByRole("link", { name: "Answer it in Returns" }).click();
  const request = page.getByRole("listitem", { name: "Return for order #1001" });
  await expect(request).toContainText("It arrived damaged");
  await expect(request).toContainText("The glass is cracked.");
  const paid = await request.getByLabel("Amount").inputValue();
  expect(Number(paid)).toBeGreaterThan(0);
  await shot(page, "110-returns-admin");
  await request.getByRole("button", { name: "Approve" }).click();
  await expect(request).toContainText("Approved, not refunded");
  expect(await lastEmail(page, email, "Your return for order #1001")).toContain("What to do next: Send it to 9 Dock Rd");

  await buyer.reload();
  await expect(buyer.locator("#returns")).toContainText("approved your return");
  await expect(buyer.locator("#returns")).toContainText("Send it to 9 Dock Rd");

  // The item comes back: refund it. It moves to Answered and the order shows the refund.
  await request.getByRole("button", { name: "Refund" }).click();
  await expect(page.getByRole("listitem", { name: "Answered return for order #1001" })).toContainText("Refunded");
  await expect(page.getByText("No returns to answer.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.locator("#returns")).toContainText(`refunded $${paid}`);
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).first().getAttribute("href"))!);
  await expect(page.getByText(`Refunded $${paid}: Return: It arrived damaged`)).toBeVisible();
});

test("store credit instead of a refund, declining needs a reason, and returns can be turned off", async ({ page, browser }, info) => {
  const id = `${info.project.name}-sc-${Date.now()}`;
  const lamp = await newMerchantWithLamp(page, id);
  const email = `rt-credit-${id}@example.com`;
  const buyer = await buyLamp(browser, info, lamp, email);
  await askForReturn(buyer, "I changed my mind");

  await page.goto("/admin/returns");
  const request = page.getByRole("listitem", { name: "Return for order #1001" });
  await request.getByRole("button", { name: "Decline" }).click();
  await expect(request).toContainText("Tell the buyer why");
  await request.getByLabel("Message to the buyer").fill("Lamps can't come back once they've been used. Sorry!");
  await request.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("listitem", { name: "Answered return for order #1001" })).toContainText("Declined");
  await buyer.reload();
  await expect(buyer.locator("#returns")).toContainText("couldn't accept this return");
  await expect(buyer.locator("#returns")).toContainText("Lamps can't come back");

  // They can ask again; this time the merchant gives store credit.
  await askForReturn(buyer, "It doesn't fit");
  await page.reload();
  await request.getByLabel("Amount").fill("5");
  await request.getByRole("button", { name: "Give store credit" }).click();
  await expect(page.getByRole("listitem", { name: "Answered return for order #1001" }).first()).toContainText("Store credit");
  expect(await lastEmail(page, email, "Your $5.00 gift card for")).toMatch(/Gift card code: [A-Z2-9-]{19}/);
  await buyer.reload();
  await expect(buyer.locator("#returns")).toContainText("$5.00 in store credit");

  await page.getByLabel("Days buyers have to ask").fill("0");
  await page.getByRole("button", { name: "Save return settings" }).click();
  await expect(page.getByText("Return settings saved.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.locator("#returns")).toContainText("handles returns by email");
  await expect(buyer.getByText("Return something")).toHaveCount(0);
});
