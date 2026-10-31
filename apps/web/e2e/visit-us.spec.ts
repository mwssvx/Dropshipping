import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The home page's "Visit us": a shop's address, opening hours and a directions button that opens
// a map search in a new tab. Nothing loads from a map until then. Hidden until the address is set.

test("a merchant shows where to find their shop", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`visit-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Visit ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Visit/ })).toBeVisible();
  const handle = `visit-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("store_location");
  const draft = preview.getByRole("region", { name: "Visit us" });
  await expect(draft).toHaveCount(0);
  await page.getByLabel("Address", { exact: true }).fill("12 Mill Lane\nBristol BS1 4RB");
  await draft.scrollIntoViewIfNeeded();
  await expect(draft.locator("address")).toHaveText("12 Mill Lane\nBristol BS1 4RB");
  await page.getByRole("button", { name: "Add a row of hours" }).click();
  await page.getByLabel("Days 1").fill("Mon–Fri");
  await page.getByLabel("Hours 1").fill("9:00–17:30");
  await page.getByRole("button", { name: "Add a row of hours" }).click();
  await page.getByLabel("Days 2").fill("Sun");
  await page.getByLabel("Hours 2").fill("Closed");
  await page.getByLabel("Text (optional)").fill("Park on Mill Lane, it's free after 6.");
  await expect(draft.getByRole("definition")).toHaveText(["9:00–17:30", "Closed"]);
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyerContext = await browser.newContext({ ...info.project.use });
  const buyer = await buyerContext.newPage();
  const maps: string[] = [];
  buyer.on("request", (r) => { if (/google\.com\/maps/.test(r.url())) maps.push(r.url()); });
  await buyer.goto(`/s/${handle}`);
  const live = buyer.getByRole("region", { name: "Visit us" });
  await live.scrollIntoViewIfNeeded();
  await expect(live.getByRole("heading", { name: "Opening hours" })).toBeVisible();
  await expect(live.getByRole("term")).toHaveText(["Mon–Fri", "Sun"]);
  await expect(live.getByText("Park on Mill Lane, it's free after 6.")).toBeVisible();
  const directions = live.getByRole("link", { name: "Get directions (opens in a new tab)" });
  await expect(directions).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=12%20Mill%20Lane%20Bristol%20BS1%204RB");
  await expect(directions).toHaveAttribute("target", "_blank");
  expect(maps).toEqual([]);
  const result = await new AxeBuilder({ page: buyer }).include('section[aria-label="Visit us"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await buyerContext.close();
});
