import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The home page's collection tabs: a few collections as tabs over one product grid, switched
// with a click or the arrow keys. With one collection it's just that collection's grid.

test("a merchant shows collections as tabs that shoppers switch between", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`tabs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Tabs ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Tabs/ })).toBeVisible();
  const handle = `tabs-${id}`.toLowerCase();
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  }
  for (const [title, product] of [["Night lights", /Sunset Projection Lamp/], ["Desk", /Magnetic Phone Stand/]] as const) {
    await page.goto("/admin/collections/new");
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: product }).click();
    await page.getByRole("button", { name: "Save collection" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  }

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("collection_tabs");
  await page.getByLabel("Heading").fill("Shop by room");
  // Picking Desk first puts its tab first.
  await page.getByRole("checkbox", { name: "Desk" }).check();
  await page.getByRole("checkbox", { name: "Night lights" }).check();
  const draft = preview.getByRole("region", { name: "Shop by room" });
  await draft.scrollIntoViewIfNeeded();
  await expect(draft.getByRole("tab")).toHaveText(["Desk", "Night lights"]);
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyerContext = await browser.newContext({ ...info.project.use });
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  const live = buyer.getByRole("region", { name: "Shop by room" });
  await live.scrollIntoViewIfNeeded();
  const tabs = live.getByRole("tablist", { name: "Shop by room" });
  const desk = tabs.getByRole("tab", { name: "Desk" });
  const lights = tabs.getByRole("tab", { name: "Night lights" });
  await expect(desk).toHaveAttribute("aria-selected", "true");
  const panel = live.getByRole("tabpanel");
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAccessibleName("Desk");
  await expect(panel.getByRole("link", { name: /Magnetic Phone Stand/ }).first()).toBeVisible();
  await expect(live.getByRole("link", { name: /Sunset Projection Lamp/ })).toHaveCount(0);

  await lights.click();
  await expect(lights).toHaveAttribute("aria-selected", "true");
  await expect(panel).toHaveAccessibleName("Night lights");
  await expect(panel.getByRole("link", { name: /Sunset Projection Lamp/ }).first()).toBeVisible();
  await expect(panel.getByRole("link", { name: "Shop all Night lights" })).toHaveAttribute("href", `/s/${handle}/collections/night-lights`);

  // The arrow keys wrap around, and only the chosen tab is in the Tab order.
  await lights.focus();
  await buyer.keyboard.press("ArrowRight");
  await expect(desk).toBeFocused();
  await expect(desk).toHaveAttribute("aria-selected", "true");
  await expect(lights).toHaveAttribute("tabindex", "-1");
  await buyer.keyboard.press("End");
  await expect(lights).toBeFocused();
  await expect(panel).toHaveAccessibleName("Night lights");
  const result = await new AxeBuilder({ page: buyer }).include(".sf-collection-tabs").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);

  // With only one collection left to show, there are no tabs, just its products.
  await page.getByRole("checkbox", { name: "Desk" }).uncheck();
  await expect(draft.getByRole("tab")).toHaveCount(0);
  await expect(draft.getByRole("link", { name: /Sunset Projection Lamp/ }).first()).toBeVisible();
  await buyerContext.close();
});
