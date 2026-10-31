import { expect, test } from "@playwright/test";

// The sign-up pop-up can wait until a visitor looks about to leave: the mouse heading out through
// the top of the window. Phones have no mouse, so there it opens after 30 seconds.

test("the sign-up pop-up opens when a visitor is about to leave", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`leave-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Leave ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Leave/ })).toBeVisible();
  const store = `/s/${`leave-${id}`.toLowerCase()}`;

  await page.goto("/admin/marketing");
  await page.getByLabel("Show the pop-up").selectOption({ label: "When a visitor is about to leave (after 30 seconds on phones)" });
  await page.getByRole("button", { name: "Save pop-up" }).click();
  await expect(page.getByRole("region", { name: "Sign-up pop-up" }).getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByLabel("Show the pop-up")).toHaveValue("0");

  const context = await browser.newContext({ ...info.project.use });
  const visitor = await context.newPage();
  await visitor.clock.install();
  await visitor.goto(store);
  await expect(visitor.getByRole("heading", { name: /Welcome/ }).first()).toBeVisible();
  const popup = visitor.getByRole("dialog", { name: "Get our news first" });
  const leave = () => visitor.evaluate(() => document.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, clientX: 300, clientY: -2, relatedTarget: null })));
  // Staying on the page doesn't open it, and neither does a glance at the tabs right on arrival.
  await leave();
  await visitor.clock.fastForward(20_000);
  await expect(popup).toBeHidden();
  if (info.project.name === "phone") {
    // No mouse: it opens after 30 seconds instead.
    await visitor.clock.fastForward(11_000);
    await expect(popup).toBeVisible();
  } else {
    await visitor.clock.fastForward(20_000);
    await expect(popup).toBeHidden();
    // Moving within the page isn't leaving.
    await visitor.evaluate(() => document.body.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, clientX: 300, clientY: 200, relatedTarget: document.documentElement })));
    await expect(popup).toBeHidden();
    await leave();
    await expect(popup).toBeVisible();
  }
  await popup.getByRole("button", { name: "No thanks" }).click();
  await expect(popup).toBeHidden();
  await visitor.reload();
  await leave();
  await visitor.clock.fastForward(40_000);
  await expect(popup).toBeHidden();
  await context.close();
});
