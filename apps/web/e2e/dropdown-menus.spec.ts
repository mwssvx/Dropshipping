import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// A header menu item can open a dropdown of links. On wide screens it opens on click and
// closes with Escape; in the phone menu its links are listed under it.

test("a merchant adds a dropdown to the header menu", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`menus-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Menus ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Menus/ })).toBeVisible();
  const handle = `menus-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  await page.frameLocator('iframe[title="Store preview"]').getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("tab", { name: "Menus" }).click();
  const shopAll = page.getByRole("group", { name: "Header menu: Shop all" });
  await shopAll.getByRole("button", { name: "Add a dropdown link" }).click();
  await shopAll.getByLabel("Dropdown label 1").fill("Gift cards");
  await shopAll.getByLabel("Dropdown link 1").fill("/gift-cards");
  await shopAll.getByRole("button", { name: "Add a dropdown link" }).click();
  await shopAll.getByLabel("Dropdown label 2").fill("Track an order");
  await shopAll.getByLabel("Dropdown link 2").fill("/track");
  // The footer menu has no dropdowns.
  await expect(page.getByRole("group", { name: /^Footer menu/ }).getByRole("button", { name: "Add a dropdown link" })).toHaveCount(0);
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyerContext = await browser.newContext({ ...info.project.use });
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  if (info.project.name === "phone") {
    await buyer.getByLabel("Menu", { exact: true }).click();
    const menu = buyer.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    await expect(menu.getByRole("link", { name: "Shop all" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Gift cards" })).toHaveAttribute("href", `/s/${handle}/gift-cards`);
    await menu.getByRole("link", { name: "Track an order" }).click();
    await expect(buyer).toHaveURL(new RegExp(`/s/${handle}/track$`));
  } else {
    const nav = buyer.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    const button = nav.getByRole("button", { name: "Shop all" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("link", { name: "Gift cards" })).toBeHidden();
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    // The item's own page comes first, then its dropdown links.
    await expect(nav.getByRole("listitem")).toHaveText(["Shop all", "Gift cards", "Track an order"]);
    const axe = await new AxeBuilder({ page: buyer }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await buyer.keyboard.press("Escape");
    await expect(nav.getByRole("link", { name: "Gift cards" })).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await buyer.getByRole("heading", { name: /Welcome/ }).click();
    await expect(nav.getByRole("link", { name: "Gift cards" })).toBeHidden();
    await button.click();
    await nav.getByRole("link", { name: "Gift cards" }).click();
    await expect(buyer).toHaveURL(new RegExp(`/s/${handle}/gift-cards$`));
  }
  await buyerContext.close();
});
