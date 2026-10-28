import { expect, test } from "@playwright/test";

// The sign-up pop-up asks new visitors for their email a few seconds after they arrive, once, and
// stays away from the cart.

test("a new visitor gets the sign-up pop-up once", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Popup ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Popup/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const store = lamp.replace(/\/products\/.*$/, "");

  await page.goto("/admin/marketing");
  await page.getByLabel("Show the pop-up").selectOption({ label: "5 seconds after a visitor arrives" });
  await page.getByRole("button", { name: "Save pop-up" }).click();
  await expect(page.getByRole("region", { name: "Sign-up pop-up" }).getByRole("status")).toHaveText("Saved.");

  const visitor = await (await browser.newContext({ ...info.project.use })).newPage();
  // Never on the cart.
  await visitor.goto(`${store}/cart`);
  await visitor.waitForTimeout(6500);
  await expect(visitor.getByRole("dialog")).toHaveCount(0);

  await visitor.goto(lamp);
  const popup = visitor.getByRole("dialog", { name: "Get our news first" });
  await expect(popup).toBeVisible({ timeout: 10_000 });
  await popup.getByLabel("Email for news and offers").fill("not an email");
  await popup.getByLabel("Email for news and offers").evaluate((el: HTMLInputElement) => (el.type = "text"));
  await popup.getByRole("button", { name: "Sign up" }).click();
  await expect(popup.getByRole("status")).toHaveText("That email address doesn't look right. Try again.");
  await popup.getByLabel("Email for news and offers").fill(`fan-${id}@example.com`);
  await popup.getByRole("button", { name: "Sign up" }).click();
  await expect(popup.getByRole("status")).toHaveText("Check your inbox: click the link we sent to confirm.");
  await popup.getByRole("button", { name: "Close" }).last().click();
  await expect(popup).toBeHidden();

  // Not again for this visitor.
  await visitor.reload();
  await visitor.waitForTimeout(6500);
  await expect(visitor.getByRole("dialog")).toHaveCount(0);

  // "No thanks" keeps it away too.
  const other = await (await browser.newContext({ ...info.project.use })).newPage();
  await other.goto(store);
  const again = other.getByRole("dialog", { name: "Get our news first" });
  await expect(again).toBeVisible({ timeout: 10_000 });
  await again.getByRole("button", { name: "No thanks" }).click();
  await expect(again).toBeHidden();
  await other.reload();
  await other.waitForTimeout(6500);
  await expect(other.getByRole("dialog")).toHaveCount(0);
  await visitor.context().close();
  await other.context().close();
});
