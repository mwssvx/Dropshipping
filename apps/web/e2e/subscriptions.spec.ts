import { expect, test, type Page } from "@playwright/test";

// Subscribe and save: after paying, a buyer subscribes to their order from its page, manages it from
// a private page, and each delivery is its own order charged to the saved card.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a buyer subscribes to their order and manages it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sub-${id}@example.com`);
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

  await page.goto("/admin/marketing");
  const setting = page.getByRole("region", { name: "Subscribe and save" });
  await setting.getByLabel("Let buyers subscribe to their order").check();
  await setting.getByLabel("Subscriber saves (%)").fill("40");
  await setting.getByRole("button", { name: "Save subscribe and save" }).click();
  await expect(setting.getByRole("alert")).toContainText("Keep it to 30% off or less.");
  await expect(setting.getByLabel("Let buyers subscribe to their order")).toBeChecked();
  await setting.getByLabel("Subscriber saves (%)").fill("15");
  await setting.getByRole("button", { name: "Save subscribe and save" }).click();
  await expect(setting.getByText("Saved. Buyers see the offer on their order page after paying.")).toBeVisible();
  await shot(page, "271-subscribe-setting");

  // The buyer pays for a lamp, then subscribes from the order page.
  const email = `ada-${id}@example.com`;
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
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
  const card = buyer.getByRole("region", { name: "Get this again automatically and save 15%" });
  await expect(async () => {
    await buyer.reload();
    await expect(card).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(card.getByRole("list", { name: "Each delivery" })).toContainText("Sunset Projection Lamp");
  await shot(buyer, "272-subscribe-offer");
  await card.getByLabel("How often").selectOption({ label: "Every 2 weeks" });
  await card.getByRole("button", { name: "Subscribe and save 15%" }).click();
  await expect(buyer.getByText(/You're subscribed\. Every 2 weeks we'll send this again for 15% less\. Next delivery: /)).toBeVisible();
  await expect(card).toHaveCount(0);

  // The private page: change how often, skip, pause and resume.
  await buyer.getByRole("link", { name: "Manage subscription" }).click();
  await expect(buyer.getByRole("heading", { name: "Your subscription" })).toBeVisible();
  await expect(buyer.getByText(/^Every 2 weeks, 15% off the price at the time/)).toBeVisible();
  const subscriptionUrl = buyer.url();
  const change = buyer.getByRole("region", { name: "Change it" });
  await change.getByLabel("How often").selectOption({ label: "Every month" });
  await change.getByRole("button", { name: "Save" }).click();
  await expect(change.getByText("Saved. Your next delivery date has moved to match.")).toBeVisible();
  await expect(change.getByLabel("How often")).toHaveValue("30");
  await expect(buyer.getByText(/^Every month, 15% off/)).toBeVisible();
  await change.getByRole("button", { name: "Skip next delivery" }).click();
  await expect(change.getByText("Skipped. Your next delivery date is below.")).toBeVisible();
  await change.getByRole("button", { name: "Pause" }).click();
  await expect(change.getByText("Paused. Nothing will be sent or charged until you resume.")).toBeVisible();
  await change.getByRole("button", { name: "Resume" }).click();
  await expect(change.getByText("Resumed. Your next delivery date is below.")).toBeVisible();
  await shot(buyer, "273-subscription-page");

  // The merchant sees it, and in test mode sends the next delivery now.
  await page.goto("/admin/subscriptions");
  const row = page.getByRole("listitem", { name: `${email} (order #1001)` });
  await expect(row).toContainText("Every month, 15% off");
  await expect(row).toContainText("Active");
  await row.getByRole("button", { name: /^Send next delivery now/ }).click();
  await expect(row.getByText("Placed order #1002.")).toBeVisible();
  await expect(row).toContainText("1 delivery");
  await shot(page, "274-admin-subscriptions");
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1002" }).getAttribute("href"))!);
  await expect(page.getByRole("link", { name: "Subscription", exact: true })).toBeVisible();

  // The buyer sees the delivery, and its order page links back.
  await buyer.goto(subscriptionUrl);
  const past = buyer.getByRole("region", { name: "Deliveries so far" });
  await expect(past).toContainText("Order #1002");
  await past.getByRole("link", { name: "Track" }).click();
  await expect(buyer.getByText("A delivery from your subscription, charged to your saved card.")).toBeVisible();

  // Cancelling asks twice.
  await buyer.goto(subscriptionUrl);
  await buyer.getByRole("button", { name: "Cancel subscription" }).click();
  await buyer.getByRole("button", { name: "Keep it" }).click();
  await buyer.getByRole("button", { name: "Cancel subscription" }).click();
  await buyer.getByRole("button", { name: "Yes, cancel subscription" }).click();
  await expect(buyer.getByText(/This subscription was cancelled on .*You won't be charged again\./)).toBeVisible();
  await expect(buyer.getByRole("region", { name: "Change it" })).toHaveCount(0);
});
