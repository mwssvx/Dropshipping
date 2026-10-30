import { expect, test } from "@playwright/test";

// Deal of the day: the merchant plans two days of deals starting today, and the store's /deal link
// takes a buyer to today's product at the lower price.

test("a merchant plans deals of the day and the link goes to today's", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`deals-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Deals ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Deals/ })).toBeVisible();
  let lamp = "";
  for (const name of [/sunset projection lamp/i, /galaxy projector low stock/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    lamp ||= (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  }

  await page.goto("/admin/sales");
  const deals = page.getByRole("region", { name: "Deal of the day" });
  const pick = async (label: string, product: RegExp) => {
    const select = deals.getByLabel(label, { exact: true });
    await select.selectOption((await select.locator("option").filter({ hasText: product }).first().getAttribute("value"))!);
  };
  await pick("Day 1", /sunset/i);
  await pick("Day 2", /galaxy/i);
  await deals.getByLabel("Price cut each day (%)").fill("40");
  await deals.getByRole("button", { name: "Plan the deals" }).click();
  await expect(deals.getByRole("status")).toHaveText("2 deals planned, one a day. The first is on now.");
  const planned = deals.getByRole("list", { name: "Deals planned" });
  await expect(planned.getByRole("listitem")).toHaveCount(2);
  await expect(planned.getByRole("listitem").first()).toContainText(/On now.*Sunset Projection Lamp/i);
  await expect(page.getByRole("listitem", { name: /^Deal of the day: Sunset Projection Lamp/i })).toContainText("counts down on the store");

  // A second run can't land on the same days.
  await deals.getByLabel("First deal on").fill(new Date().toISOString().slice(0, 10));
  await pick("Day 1", /galaxy/i);
  await pick("Day 2", /sunset/i);
  await deals.getByRole("button", { name: "Plan the deals" }).click();
  await expect(deals.getByRole("alert")).toContainText("already have a deal of the day");

  // The buyer's link: the lamp, with its old price crossed out.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${lamp.split("/products/")[0]}/deal`);
  await expect(buyer).toHaveURL(new RegExp(`${lamp.split("/products/")[1]}$`));
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(/Sunset Projection Lamp/i);
  await expect(buyer.locator("s", { hasText: "$13.99" }).first()).toBeVisible();
});
