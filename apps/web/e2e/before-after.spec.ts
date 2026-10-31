import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The home page's before and after: two photos with a handle shoppers drag, or move with the
// arrow keys, to compare them. It stays hidden until both photos are set.

const BEFORE = "https://images.example.com/before.svg";
const AFTER = "https://images.example.com/after.svg";
const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${fill}"/></svg>`;
const serve = (r: import("@playwright/test").Route) => r.fulfill({ contentType: "image/svg+xml", body: svg(r.request().url().includes("before") ? "#875" : "#5a8") });

test("a merchant shows a before and after that shoppers can compare", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.context().route("https://images.example.com/**", serve);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`compare-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Compare ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Compare/ })).toBeVisible();
  const handle = `compare-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("before_after");
  await page.getByLabel("Heading").fill("One wipe, no streaks");
  const pair = preview.getByRole("region", { name: "One wipe, no streaks" });
  // One photo isn't enough to compare.
  await page.getByLabel("Before photo").fill(BEFORE);
  await expect(pair).toHaveCount(0);
  await page.getByLabel("After photo").fill(AFTER);
  await pair.scrollIntoViewIfNeeded();
  await expect(pair.getByRole("img", { name: "Before" })).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyerContext = await browser.newContext({ ...info.project.use });
  await buyerContext.route("https://images.example.com/**", serve);
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  const live = buyer.getByRole("region", { name: "One wipe, no streaks" });
  await live.scrollIntoViewIfNeeded();
  const slider = live.getByRole("slider", { name: "Drag to compare before and after" });
  await expect(slider).toHaveValue("50");
  await slider.focus();
  await buyer.keyboard.press("ArrowRight");
  await buyer.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("52");
  await expect(live.getByRole("img", { name: "After" })).toHaveAttribute("style", /inset\(0(px)? 0(px)? 0(px)? 52%\)/);
  await slider.fill("10");
  await expect(slider).toHaveAttribute("aria-valuetext", "Before 10%, After 90%");
  const result = await new AxeBuilder({ page: buyer }).include(".sf-before-after").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await buyerContext.close();
});
