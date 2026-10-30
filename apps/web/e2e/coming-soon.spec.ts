import { expect, test, type Page } from "@playwright/test";

// Coming soon: a draft that goes on sale later shows a countdown page with a box to be emailed when it's out.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

/** A datetime-local value for a moment from now, in the browser's own zone. */
const localIn = (ms: number) => {
  const d = new Date(Date.now() + ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

test("a launch shows a coming-soon page and collects emails until it goes on sale", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Launches ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Launches/ })).toBeVisible();
  const handle = `launches-${id}`.toLowerCase();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Aurora Sneaker");
  await page.getByLabel("Price", { exact: true }).fill("120.00");
  await page.getByLabel("Status").selectOption({ label: "Draft: hidden" });
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const productUrl = page.url().split("?")[0]!;

  const panel = page.getByRole("region", { name: "Put on sale later" });
  await expect(panel.getByRole("button", { name: "Show a coming-soon page" })).toHaveCount(0);
  await panel.getByLabel("Goes on sale").fill(localIn(3 * 24 * 60 * 60_000));
  await panel.getByRole("button", { name: "Schedule" }).click();
  await expect(panel.getByText(/^Goes on sale by itself on /)).toBeVisible();
  await panel.getByRole("button", { name: "Show a coming-soon page" }).click();
  await expect(panel.getByText("0 shoppers are waiting for that email.", { exact: false })).toBeVisible();

  // A shopper sees the teaser, not a buy button, and joins the list.
  const buyer = await page.context().newPage();
  const res = await buyer.goto(`/s/${handle}/products/aurora-sneaker`);
  expect(res?.status()).toBe(200);
  await expect(buyer.getByRole("heading", { name: "Aurora Sneaker" })).toBeVisible();
  await expect(buyer.getByText("Coming soon", { exact: true })).toBeVisible();
  await expect(buyer.getByText(/^On sale \w+day, /)).toBeVisible();
  await expect(buyer.getByRole("timer")).toContainText(/On sale in 2 days|On sale in 3 days/);
  await expect(buyer.getByRole("button", { name: /Add to cart/ })).toHaveCount(0);
  const form = buyer.getByRole("form", { name: "Get an email when it's out" });
  await form.getByLabel("Email").fill("fan@example.com");
  await form.getByRole("button", { name: "Notify me" }).click();
  await expect(buyer.locator(".banner-success")).toHaveText("You're on the list. We'll email you when it's out.");
  await shot(buyer, "471-coming-soon");

  await page.goto(productUrl);
  await expect(panel.getByText("1 shopper is waiting for that email.", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Turn off the coming-soon page" }).click();
  await expect(panel.getByRole("button", { name: "Show a coming-soon page" })).toBeVisible();
  expect((await buyer.goto(`/s/${handle}/products/aurora-sneaker`))?.status()).toBe(404);
  await page.goto("/admin/activity");
  await expect(page.getByText("Turned on the coming-soon page of “Aurora Sneaker”")).toBeVisible();
});
