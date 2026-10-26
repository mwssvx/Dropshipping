import { expect, test, type Page } from "@playwright/test";

// Put a product on sale later: a draft gets a launch time and waits, hidden from buyers, until then.

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

test("a merchant schedules a draft to go on sale, then cancels it", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pl-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Drops ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Drops/ })).toBeVisible();
  const handle = `drops-${id}`.toLowerCase();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Midnight Hoodie");
  await page.getByLabel("Price", { exact: true }).fill("45.00");
  await page.getByLabel("Status").selectOption({ label: "Draft: hidden" });
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  const panel = page.getByRole("region", { name: "Put on sale later" });
  await panel.getByLabel("Goes on sale").fill(localIn(-60 * 60_000));
  await panel.getByRole("button", { name: "Schedule" }).click();
  await expect(panel.getByText("Pick a time in the future, or put it on sale now.")).toBeVisible();
  await panel.getByLabel("Goes on sale").fill(localIn(2 * 24 * 60 * 60_000));
  await panel.getByRole("button", { name: "Schedule" }).click();
  await expect(panel.getByText(/^Goes on sale by itself on /)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Change time" })).toBeVisible();
  await shot(page, "395-publish-later");

  // Hidden from buyers until then, and marked in the list.
  const buyer = await page.context().newPage();
  const res = await buyer.goto(`/s/${handle}/products/midnight-hoodie`);
  expect(res?.status()).toBe(404);
  await page.goto("/admin/products");
  await expect(page.getByRole("row", { name: /Midnight Hoodie/ }).getByText("Scheduled")).toBeVisible();

  await page.getByRole("link", { name: "Midnight Hoodie" }).click();
  await panel.getByRole("button", { name: "Cancel schedule" }).click();
  await expect(panel.getByText("Cancelled. It stays a draft until you put it on sale.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Schedule" })).toBeVisible();
  await page.goto("/admin/activity");
  await expect(page.getByText("Scheduled “Midnight Hoodie” to go on sale")).toBeVisible();
});
