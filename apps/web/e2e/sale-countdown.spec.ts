import { expect, test, type Page } from "@playwright/test";

// Sale countdown: a sale with an end time can count down on the store, with a banner when it
// covers everything.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

// A datetime-local value, in the browser's time zone, this many hours from now.
const inHours = (h: number) => {
  const d = new Date(Date.now() + h * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

test("a sale on everything counts down on the store", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`countdown-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Clock ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Clock/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/sales");
  const clock = page.getByLabel("Count down to the end on the store");
  // No end time, no countdown.
  await expect(clock).toBeDisabled();
  await page.getByLabel("Name").fill("Weekend sale");
  await page.getByLabel("Discount (%)").fill("20");
  await page.getByLabel("Ends").fill(inHours(26));
  await clock.check();
  await page.getByRole("button", { name: "Add sale" }).click();
  await expect(page.getByText("Sale added. It's on the store now.")).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Weekend sale" })).toContainText("counts down on the store");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  // The banner across the store, and the time left by the price.
  await expect(buyer.getByText("Weekend sale: 20% off everything.")).toBeVisible();
  const timers = buyer.getByRole("timer");
  await expect(timers).toHaveCount(2);
  await expect(timers.first()).toHaveText(/^Ends in 1 day \d\d:\d\d:\d\d$/);
  // It ticks.
  const before = await timers.last().textContent();
  await expect(timers.last()).not.toHaveText(before!, { timeout: 3000 });
  await shot(buyer, "440-sale-countdown");

  // Ending the sale takes the clock away.
  await page.getByRole("listitem", { name: "Weekend sale" }).getByRole("button", { name: "End now" }).click();
  await buyer.reload();
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.getByRole("timer")).toHaveCount(0);
});
